const DATABASE_URL = process.env.DATABASE_URL;
require('./run-isolated.cjs').assertIsolatedDatabase(DATABASE_URL);
if (process.env.NODE_ENV !== 'test' || process.env.MEDIA_DRIVER !== 'memory') {
  throw new Error('Packing concurrency integration requires NODE_ENV=test and MEDIA_DRIVER=memory');
}

require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Prisma } = require('@prisma/client');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { AccessService } = require('../dist/access/access.service');
const { PackingService } = require('../dist/packing/packing.service');
const { TripsService } = require('../dist/trips/trips.service');

// Every row is fictional and confined to a new household/trip. This prefix is
// deliberately different from access.integration.test.cjs's verification- prefix.
// No fixture deletion is needed: the verification database uses disposable tmpfs.
const FIXTURE_PREFIX = 'packing-concurrency-fictional-';
const TRANSACTION_TIMEOUT_MS = 20_000;

function fixtureText(value, maximum) {
  assert.ok(value.length >= 1 && value.length <= maximum, `Fictional text must satisfy DTO Length(1, ${maximum})`);
  return value;
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function bounded(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
}

const outcomeOf = promise => promise.then(value => ({ value }), error => ({ error }));

function databaseClient() {
  const connection = new URL(DATABASE_URL);
  // Independent engines, each with one connection, make the two backend PIDs
  // checked below the same physical connections used by the competing services.
  connection.searchParams.set('connection_limit', '1');
  connection.searchParams.set('connect_timeout', '5');
  connection.searchParams.set('pool_timeout', '5');
  return new PrismaService({
    datasources: { db: { url: connection.toString() } },
    transactionOptions: { maxWait: 5_000, timeout: TRANSACTION_TIMEOUT_MS },
  });
}

async function backend(db) {
  const [row] = await db.$queryRawUnsafe('SELECT pg_backend_pid() AS pid, current_database() AS database, current_user AS username, current_schema() AS schema');
  assert.equal(row.database, 'verify');
  assert.equal(row.username, 'verify');
  assert.equal(row.schema, 'public');
  return row.pid;
}

async function fixture(db) {
  const unique = randomUUID();
  const marker = FIXTURE_PREFIX + unique;
  const label = `pkrace-${unique.slice(0, 8)}`;
  const household = await db.household.create({
    data: {
      name: fixtureText(`${label}-household`, 40),
      members: { create: ['owner', 'revoked', 'retained'].map(kind => ({
        status: 'ACTIVE',
        user: { create: { openId: `${marker}-${kind}`, nickname: fixtureText(`${label}-${kind}`, 30) } },
        ...(kind === 'owner' ? { permissions: { create: { module: 'trips', level: 'EDIT', effect: 'ALLOW' } } } : {}),
      })) },
    },
    include: { members: { include: { user: true } } },
  });
  const member = kind => household.members.find(value => value.user.openId === `${marker}-${kind}`);
  const owner = member('owner'), target = member('revoked'), retained = member('retained');
  assert.ok(owner && target && retained);
  const trips = new TripsService(db, new AccessService(db));
  const trip = (await trips.create(owner.userId, household.id, {
    title: fixtureText(`${label}-trip`, 80), startsAt: '2026-11-01T08:00:00+08:00',
  })).data;
  for (const membership of [target, retained]) {
    await trips.addMember(owner.userId, household.id, trip.id, { membershipId: membership.id, canEdit: true, photoAdd: true });
  }
  const group = (await trips.createGroup(owner.userId, household.id, trip.id, {
    name: fixtureText(`${label}-group`, 40), membershipIds: [target.id, retained.id],
  })).data;
  const createItem = (suffix, data) => db.tripPackingItem.create({ data: {
    tripId: trip.id, name: fixtureText(`${label}-${suffix}`, 80), groupId: group.id,
    quantity: '3.125', unit: '件', note: `${marker}-original-note`, ...data,
  } });
  const subject = await createItem('reassignment-subject', { responsibleMembershipId: retained.id, version: 11 });
  const unrelated = await createItem('unrelated-packed-item', { responsibleMembershipId: retained.id, status: 'PACKED', version: 17, quantity: '7.375' });
  const toClear = await createItem('existing-responsibility-to-clear', { responsibleMembershipId: target.id, version: 23 });
  return {
    marker, label, householdId: household.id, owner, target, retained, trip, group, subject, unrelated, toClear,
    targetBefore: await db.tripMember.findUniqueOrThrow({ where: { tripId_membershipId: { tripId: trip.id, membershipId: target.id } } }),
    tripBefore: await db.trip.findUniqueOrThrow({ where: { id: trip.id } }),
    groupBefore: await db.tripPreparationGroup.findUniqueOrThrow({ where: { id: group.id } }),
    itemsBefore: await db.tripPackingItem.findMany({ where: { tripId: trip.id }, orderBy: { id: 'asc' } }),
  };
}

function observePackingTransactions(db, f, expectedBackend) {
  const reached = deferred(), release = deferred();
  const observation = { attempts: [], groupReads: [], events: [], paused: false };

  function groupDelegate(delegate, attempt) {
    return new Proxy(delegate, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (property !== 'findUnique') return typeof value === 'function' ? value.bind(target) : value;
        return async (...args) => {
          // Await the real SELECT before pausing. No result, conflict, or database
          // response is fabricated, and all other delegates pass through intact.
          const row = await value.apply(target, args);
          const key = args[0]?.where?.groupId_membershipId;
          if (key?.groupId === f.group.id && key.membershipId === f.target.id) {
            observation.groupReads.push({ attempt, row });
            if (!observation.paused) {
              observation.paused = true;
              assert.ok(row, 'The first real SELECT must observe the still-present preparation-group membership');
              assert.equal(row.tripId, f.trip.id);
              observation.events.push('assignment-select-returned');
              reached.resolve();
              await bounded(release.promise, 15_000, 'Assignment barrier release');
            }
          }
          return row;
        };
      },
    });
  }

  function transactionClient(tx, attempt) {
    return new Proxy(tx, {
      get(target, property) {
        if (property === 'tripPreparationGroupMember') return groupDelegate(target.tripPreparationGroupMember, attempt);
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  const client = new Proxy(db, {
    get(target, property) {
      // Also instrument the root delegate so the pre-fix nontransactional
      // implementation reproduces its illegal write under the same interleaving.
      if (property === 'tripPreparationGroupMember') return groupDelegate(target.tripPreparationGroupMember, 0);
      if (property === '$transaction') return async (action, options) => {
        assert.equal(typeof action, 'function');
        assert.equal(options?.isolationLevel, 'Serializable');
        const attempt = { number: observation.attempts.length + 1 };
        observation.attempts.push(attempt);
        observation.events.push(`attempt-${attempt.number}-started`);
        try {
          const result = await target.$transaction(async tx => {
            const [settings] = await tx.$queryRawUnsafe("SELECT current_setting('transaction_isolation') AS isolation, pg_backend_pid() AS pid");
            attempt.isolation = settings.isolation;
            attempt.backend = settings.pid;
            assert.equal(settings.isolation, 'serializable', 'PostgreSQL itself must run the assignment transaction at Serializable');
            assert.equal(settings.pid, expectedBackend);
            return action(transactionClient(tx, attempt.number));
          }, options);
          attempt.committed = true;
          return result;
        } catch (error) {
          // This is the error returned by the real Prisma transaction. Rethrow
          // that same object for the production serializable() retry policy.
          attempt.error = error;
          observation.events.push(error.code === 'P2034' ? 'postgresql-P2034' : `attempt-${attempt.number}-rejected`);
          throw error;
        }
      };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { client, observation, reached: reached.promise, release: release.resolve };
}

for (const operation of ['creation', 'reassignment']) {
  test(`PostgreSQL packing ${operation}: committed member revocation forces P2034, fresh retry rejects stale assignment, and unrelated luggage survives`, { timeout: 90_000 }, async t => {
    const assignmentDb = databaseClient(), revocationDb = databaseClient();
    let controlled, assignmentOutcome, revocationOutcome;
    try {
      await bounded(Promise.all([assignmentDb.$connect(), revocationDb.$connect()]), 10_000, 'Two isolated PostgreSQL connections');
      const [assignmentBackend, revocationBackend] = await Promise.all([backend(assignmentDb), backend(revocationDb)]);
      assert.notEqual(assignmentBackend, revocationBackend, 'The revoker must use a second physical PostgreSQL connection');
      const f = await bounded(fixture(assignmentDb), 20_000, 'Fictional fixture creation');
      controlled = observePackingTransactions(assignmentDb, f, assignmentBackend);
      const packing = new PackingService(controlled.client, new AccessService(controlled.client));
      const trips = new TripsService(revocationDb, new AccessService(revocationDb));
      const assignment = { groupId: f.group.id, responsibleMembershipId: f.target.id, quantity: 91.875, note: `${f.marker}-must-not-commit` };
      const attemptedName = fixtureText(`${f.label}-must-not-commit-name`, 80);
      assignmentOutcome = outcomeOf(operation === 'creation'
        ? packing.createTripItem(f.owner.userId, f.householdId, f.trip.id, { name: attemptedName, unit: '顶', ...assignment })
        : packing.updateTripItem(f.owner.userId, f.householdId, f.trip.id, f.subject.id, { expectedVersion: f.subject.version, name: attemptedName, ...assignment }));

      await bounded(Promise.race([
        controlled.reached,
        assignmentOutcome.then(outcome => { throw new Error(`Assignment ended before the real group SELECT barrier: ${outcome.error?.name || 'unexpected success'}`); }),
      ]), 10_000, 'First real assignment SELECT');
      revocationOutcome = outcomeOf(trips.updateMember(f.owner.userId, f.householdId, f.trip.id, f.target.id, {
        expectedVersion: f.targetBefore.version, status: 'REVOKED', clearResponsibilities: true,
      }));
      const revoked = await bounded(revocationOutcome, 12_000, 'Concurrent real member revocation');
      if (revoked.error) throw revoked.error;
      controlled.observation.events.push('revocation-committed');
      // Check committed state on the independent connection while the original
      // assignment is still paused, before permitting its INSERT/UPDATE.
      assert.equal((await revocationDb.tripMember.findUniqueOrThrow({ where: { tripId_membershipId: { tripId: f.trip.id, membershipId: f.target.id } } })).status, 'REVOKED');
      assert.equal(await revocationDb.tripPreparationGroupMember.count({ where: { tripId: f.trip.id, membershipId: f.target.id } }), 0);
      assert.equal(await revocationDb.tripPackingItem.count({ where: { tripId: f.trip.id, responsibleMembershipId: f.target.id } }), 0);
      controlled.observation.events.push('assignment-released');
      controlled.release();

      const rejected = await bounded(assignmentOutcome, 25_000, 'Assignment serialization retry and rejection');
      assert.ok(rejected.error, 'The original assignment request must reject after the committed revocation');
      assert.equal(rejected.error.getStatus?.(), 400, 'A fresh retry must reject the now-REVOKED assignee as a BadRequest');
      assert.match(rejected.error.message, /responsible member must be active/i);
      const { attempts, groupReads, events } = controlled.observation;
      assert.equal(attempts.length, 2, 'The real serializable helper must retry exactly once');
      assert.ok(attempts[0].error instanceof Prisma.PrismaClientKnownRequestError);
      assert.equal(attempts[0].error.code, 'P2034', 'Require an actual PostgreSQL serialization failure; P2028 timeouts do not qualify');
      assert.equal(attempts[1].error, rejected.error, 'The second real transaction must supply the business rejection');
      assert.ok(attempts.every(attempt => attempt.isolation === 'serializable' && attempt.backend === assignmentBackend && !attempt.committed));
      assert.equal(groupReads.length, 1, 'The retry must re-read the revoked member and reject before the obsolete group check');
      assert.equal(groupReads[0].attempt, 1);
      assert.equal(groupReads[0].row.membershipId, f.target.id);
      assert.deepEqual(events, ['attempt-1-started', 'assignment-select-returned', 'revocation-committed', 'assignment-released', 'postgresql-P2034', 'attempt-2-started', 'attempt-2-rejected']);

      const afterItems = await assignmentDb.tripPackingItem.findMany({ where: { tripId: f.trip.id }, orderBy: { id: 'asc' } });
      assert.equal(afterItems.length, f.itemsBefore.length, 'Rejected creation/reassignment must not add or remove luggage');
      assert.equal(await assignmentDb.tripPackingItem.count({ where: { tripId: f.trip.id, name: attemptedName } }), 0);
      assert.equal(await assignmentDb.tripPackingItem.count({ where: { tripId: f.trip.id, responsibleMembershipId: f.target.id } }), 0, 'No luggage may reference the revoked or removed member');
      for (const before of f.itemsBefore) {
        const after = afterItems.find(item => item.id === before.id);
        assert.ok(after);
        if (before.id === f.toClear.id) {
          assert.deepEqual(after, { ...before, responsibleMembershipId: null, version: before.version + 1, updatedAt: after.updatedAt });
          assert.ok(after.updatedAt >= before.updatedAt);
        } else {
          assert.deepEqual(after, before, 'Every unrelated/reassignment-source field, version, timestamp and decimal quantity must remain byte-for-value intact');
        }
      }
      const targetAfter = await assignmentDb.tripMember.findUniqueOrThrow({ where: { tripId_membershipId: { tripId: f.trip.id, membershipId: f.target.id } } });
      assert.ok(targetAfter.leftAt instanceof Date);
      assert.deepEqual(targetAfter, { ...f.targetBefore, status: 'REVOKED', version: f.targetBefore.version + 1, leftAt: targetAfter.leftAt });
      assert.equal((await assignmentDb.membership.findUniqueOrThrow({ where: { id: f.target.id } })).status, 'ACTIVE', 'Only this trip access is revoked');
      assert.equal(await assignmentDb.tripPreparationGroupMember.count({ where: { tripId: f.trip.id, membershipId: f.target.id } }), 0);
      assert.deepEqual(await assignmentDb.tripPreparationGroupMember.findMany({ where: { groupId: f.group.id } }), [{ groupId: f.group.id, tripId: f.trip.id, membershipId: f.retained.id }]);
      assert.deepEqual(await assignmentDb.trip.findUniqueOrThrow({ where: { id: f.trip.id } }), f.tripBefore);
      assert.deepEqual(await assignmentDb.tripPreparationGroup.findUniqueOrThrow({ where: { id: f.group.id } }), f.groupBefore);
      const audits = await assignmentDb.auditLog.findMany({ where: { householdId: f.householdId, targetId: f.trip.id, action: 'TRIP_MEMBER_UPDATE' } });
      assert.equal(audits.length, 1, 'Only the committed revocation writes a member-update audit');
      assert.equal(audits[0].actorMembershipId, f.owner.id);
      assert.equal(audits[0].details.membershipId, f.target.id);
      assert.equal(audits[0].details.status, 'REVOKED');
      assert.equal(audits[0].details.fromVersion, f.targetBefore.version);
      assert.equal(audits[0].details.toVersion, f.targetBefore.version + 1);
      t.diagnostic(JSON.stringify({ operation, database: 'isolated PostgreSQL', physicalConnections: 2, actualConflict: attempts[0].error.code, attempts: attempts.length, finalStatus: rejected.error.getStatus(), luggageCount: afterItems.length }));
    } finally {
      // Always release the read barrier, including failed revocation assertions.
      // Interactive transactions and these waits are bounded, so a failed test
      // cannot leave a blocked writer or an unhandled rejected promise behind.
      controlled?.release();
      try {
        await bounded(Promise.allSettled([assignmentOutcome, revocationOutcome].filter(Boolean)), TRANSACTION_TIMEOUT_MS + 5_000, 'Outstanding service transactions');
      } finally {
        const closed = await bounded(Promise.allSettled([assignmentDb.$disconnect(), revocationDb.$disconnect()]), 10_000, 'Prisma disconnect');
        for (const result of closed) if (result.status === 'rejected') throw result.reason;
      }
    }
  });
}
