require('reflect-metadata');
require('ts-node').register({ transpileOnly: true, compilerOptions: { incremental: false } });
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Prisma } = require('@prisma/client');
const { PackingService } = require('../src/packing/packing.service');
const { TripsService } = require('../src/trips/trips.service');

// This fixture checks service transaction boundaries, rollback and deterministic
// interleavings. It simulates serialization failure; it is not PostgreSQL evidence.
function fixture(options = {}) {
  let state = {
    trip: { id: 'trip-a', householdId: 'house-a', status: 'PENDING', version: 4 },
    members: [
      { membershipId: 'owner-a', tripRole: 'OWNER', status: 'ACTIVE', canEdit: true, photoAdd: true, version: 1 },
      { membershipId: 'friend-a', tripRole: 'MEMBER', status: 'ACTIVE', canEdit: true, photoAdd: true, version: 2 },
    ],
    groups: [{ id: 'group-a', tripId: 'trip-a', name: '朋友家', version: 1 }],
    groupMembers: [{ groupId: 'group-a', tripId: 'trip-a', membershipId: 'friend-a' }],
    memberships: [{ id: 'owner-a', status: 'ACTIVE' }, { id: 'friend-a', status: 'ACTIVE' }],
    items: [{ id: 'item-a', tripId: 'trip-a', name: '天幕', version: 7, status: 'PENDING', excludedAt: null, groupId: null, responsibleMembershipId: null }],
    template: { id: 'template-a', householdId: 'house-a', name: '周末', archived: false, items: [{ id: 'source-a', name: '帐篷', defaultQuantity: '2.000', unit: '顶', note: '检查地钉' }] },
    audits: [],
  };
  let revision = 0, conflicts = options.conflicts || 0;
  const transactionClients = [], accessClients = [], writes = [];
  let assignmentHook;
  const copy = value => structuredClone(value);
  function update(row, data) {
    for (const [key, value] of Object.entries(data)) if (value !== undefined) row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : value;
  }
  function matches(row, where) {
    return row.tripId === where.tripId && (!where.id || row.id === where.id) &&
      (where.version === undefined || row.version === where.version) &&
      (where.excludedAt === undefined || row.excludedAt === where.excludedAt) &&
      (!where.responsibleMembershipId || row.responsibleMembershipId === where.responsibleMembershipId) &&
      (!where.status || row.status === where.status);
  }
  function client(read, transaction) {
    return {
      tripMember: {
        findFirst: async input => {
          const s = read(), row = s.members.find(member => member.membershipId === input.where.membershipId && input.where.status.in.includes(member.status));
          return row ? { ...copy(row), trip: copy(s.trip) } : null;
        },
        findUnique: async input => copy(read().members.find(member => member.membershipId === input.where.tripId_membershipId.membershipId) || null),
        count: async () => 1,
        update: async input => {
          const row = read().members.find(member => member.membershipId === input.where.tripId_membershipId.membershipId);
          writes.push(['member', transaction]); update(row, input.data); return copy(row);
        },
      },
      membership: { findFirst: async input => copy(read().memberships.find(member => member.id === input.where.id && member.status === input.where.status) || null) },
      tripPreparationGroup: { findFirst: async input => copy(read().groups.find(group => group.id === input.where.id && group.tripId === input.where.tripId) || null) },
      tripPreparationGroupMember: {
        findUnique: async input => {
          const key = input.where.groupId_membershipId;
          const result = copy(read().groupMembers.find(member => member.groupId === key.groupId && member.membershipId === key.membershipId) || null);
          if (assignmentHook) { const hook = assignmentHook; assignmentHook = undefined; await hook(); }
          return result;
        },
        deleteMany: async input => {
          writes.push(['group-remove', transaction]); const s = read(), count = s.groupMembers.length;
          s.groupMembers = s.groupMembers.filter(member => member.membershipId !== input.where.membershipId);
          return { count: count - s.groupMembers.length };
        },
      },
      tripPackingItem: {
        findFirst: async input => copy(read().items.find(item => matches(item, input.where)) || null),
        findUniqueOrThrow: async input => {
          if (options.failResultRead) throw Error('result read failed');
          const row = read().items.find(item => item.id === input.where.id); if (!row) throw Error('item missing'); return copy(row);
        },
        findMany: async input => {
          if (options.failListRead) throw Error('list read failed');
          return copy(read().items.filter(item => matches(item, input.where)));
        },
        count: async input => read().items.filter(item => matches(item, input.where)).length,
        create: async input => {
          writes.push(['create', transaction]); const row = { id: `created-${read().items.length}`, version: 1, excludedAt: null, status: 'PENDING', ...input.data };
          read().items.push(row); return copy(row);
        },
        createMany: async input => {
          writes.push(['apply', transaction]); let count = 0;
          for (const data of input.data) if (!read().items.some(item => item.tripId === data.tripId && item.sourceTemplateItemId === data.sourceTemplateItemId)) {
            read().items.push({ id: `created-${read().items.length}`, version: 1, excludedAt: null, status: 'PENDING', ...data }); count++;
          }
          return { count };
        },
        updateMany: async input => {
          writes.push(['update', transaction]); if (options.failOptimisticUpdate) return { count: 0 };
          const rows = read().items.filter(item => matches(item, input.where)); rows.forEach(row => update(row, input.data)); return { count: rows.length };
        },
      },
      packingTemplate: { findFirst: async input => { const row = read().template; return row.id === input.where.id && row.householdId === input.where.householdId && !row.archived ? copy(row) : null; } },
      trip: { findFirst: async () => ({ ...copy(read().trip), members: copy(read().members.filter(member => member.status !== 'REVOKED')) }) },
      auditLog: { create: async input => { writes.push(['audit', transaction]); read().audits.push(copy(input.data)); return input.data; } },
    };
  }
  const prisma = client(() => state, false);
  prisma.$transaction = async (callback, settings) => {
    assert.equal(settings.isolationLevel, 'Serializable');
    const snapshot = copy(state), startedAt = revision, tx = client(() => snapshot, true); transactionClients.push(tx);
    const result = await callback(tx);
    if (startedAt !== revision || conflicts > 0) {
      if (conflicts > 0) conflicts--;
      throw new Prisma.PrismaClientKnownRequestError('simulated serialization conflict', { code: 'P2034', clientVersion: 'unit-fixture' });
    }
    state = snapshot; revision++; return result;
  };
  const access = { require: async (_user, _household, _module, _level, tx) => {
    accessClients.push(tx); if (options.denyAccess) { const error = Error('forbidden'); error.getStatus = () => 403; throw error; }
    return { id: 'owner-a', effectivePermissions: { trips: 'EDIT', packing_templates: 'EDIT' } };
  } };
  return {
    service: new PackingService(prisma, access), trips: new TripsService(prisma, access),
    get state() { return state; }, writes, transactionClients, accessClients,
    change: fn => fn(state), pauseAssignment: hook => { assignmentHook = hook; },
  };
}
const create = (f, input = {}) => f.service.createTripItem('user-a', 'house-a', 'trip-a', { name: ' 帐篷 ', groupId: 'group-a', responsibleMembershipId: 'friend-a', ...input });
const change = (f, input = {}) => f.service.updateTripItem('user-a', 'house-a', 'trip-a', 'item-a', { expectedVersion: 7, groupId: 'group-a', responsibleMembershipId: 'friend-a', ...input });
const status = code => error => error.getStatus?.() === code;

test('Packing assignment creation and reassignment use the same Serializable client for permission checks and writes', async () => {
  for (const operation of [create, change]) {
    const f = fixture(); const result = await operation(f);
    assert.equal(f.transactionClients.length, 1); assert.ok(f.accessClients.every(client => client === f.transactionClients[0]));
    assert.ok(f.writes.every(([, transaction]) => transaction));
    assert.equal(result.data.groupId, 'group-a'); assert.equal(result.data.responsibleMembershipId, 'friend-a');
    if (operation === create) { assert.equal(result.data.name, '帐篷'); assert.equal(f.state.items.length, 2); }
    else { assert.equal(result.data.version, 8); assert.equal(f.state.items.length, 1); }
  }
});

test('Packing assignment rejects inactive actors, ended trips, foreign groups and invalid assignees without writes', async () => {
  for (const operation of [create, change]) for (const [alter, code] of [
    [s => { s.members[0].canEdit = false; }, 403],
    [s => { s.members[0].status = 'HISTORY'; }, 403],
    [s => { s.trip.status = 'COMPLETED'; }, 409],
    [s => { s.trip.status = 'CANCELLED'; }, 409],
    [s => { s.groups[0].tripId = 'other-trip'; }, 400],
    [s => { s.members[1].status = 'REVOKED'; }, 400],
    [s => { s.memberships[1].status = 'DISABLED'; }, 400],
    [s => { s.groupMembers = []; }, 400],
  ]) {
    const f = fixture(); f.change(alter); const before = structuredClone(f.state);
    await assert.rejects(operation(f), status(code)); assert.deepEqual(f.state, before); assert.equal(f.writes.length, 0);
  }
});

test('Packing assignment stale and raced item versions return 409 without committed changes', async () => {
  for (const options of [{}, { failOptimisticUpdate: true }]) {
    const f = fixture(options), before = structuredClone(f.state);
    await assert.rejects(change(f, options.failOptimisticUpdate ? {} : { expectedVersion: 6 }), status(409));
    assert.deepEqual(f.state, before);
  }
});

test('Packing assignment result-read failure rolls the update and item version back', async () => {
  const f = fixture({ failResultRead: true }), before = structuredClone(f.state);
  await assert.rejects(change(f), /result read failed/); assert.deepEqual(f.state, before);
  assert.equal(f.transactionClients.length, 1);
});

test('Packing assignment retries serialization conflicts with fresh authorization and commits each mutation once', async () => {
  for (const operation of [create, change]) {
    const f = fixture({ conflicts: 1 }); await operation(f);
    assert.equal(f.transactionClients.length, 2); assert.equal(f.accessClients.length, 2);
    assert.equal(f.state.items.length, operation === create ? 2 : 1);
    assert.equal(f.state.items[0].version, operation === create ? 7 : 8);
  }
  const f = fixture({ conflicts: 3 }), before = structuredClone(f.state);
  await assert.rejects(change(f), status(409)); assert.deepEqual(f.state, before); assert.equal(f.transactionClients.length, 3);
});

for (const [name, operation] of [['creation', create], ['reassignment', change]]) {
  test(`Packing ${name} cannot leave responsibility on a member concurrently revoked and removed from its group`, async () => {
    const f = fixture(); let release, reached;
    const paused = new Promise(resolve => { reached = resolve; }), gate = new Promise(resolve => { release = resolve; });
    f.pauseAssignment(async () => { reached(); await gate; });
    const pending = operation(f).then(result => ({ result }), error => ({ error }));
    await paused;
    await f.trips.updateMember('user-a', 'house-a', 'trip-a', 'friend-a', { expectedVersion: 2, status: 'REVOKED', clearResponsibilities: true });
    release(); const outcome = await pending;
    assert.equal(f.state.members[1].status, 'REVOKED'); assert.equal(f.state.groupMembers.length, 0);
    assert.ok(f.state.items.every(item => item.responsibleMembershipId !== 'friend-a'));
    assert.equal(outcome.error?.getStatus(), 400); assert.equal(f.state.items.length, 1); assert.equal(f.state.items[0].version, 7);
    assert.equal(f.state.audits.length, 1); assert.equal(f.transactionClients.length, 3);
  });
}

test('Packing template application and item removal commit within Serializable authorization boundaries', async () => {
  const f = fixture();
  const first = await f.service.applyTemplate('user-a', 'house-a', 'trip-a', { templateId: 'template-a' });
  assert.equal(first.data.addedCount, 1); assert.equal(first.data.items.length, 2);
  const again = await f.service.applyTemplate('user-a', 'house-a', 'trip-a', { templateId: 'template-a' });
  assert.equal(again.data.addedCount, 0); assert.equal(again.data.skippedCount, 1); assert.equal(f.state.items.length, 2);
  await f.service.removeTripItem('user-a', 'house-a', 'trip-a', 'item-a', 7);
  assert.ok(f.state.items[0].excludedAt instanceof Date); assert.equal(f.state.items[0].version, 8);
  assert.equal(f.transactionClients.length, 3); assert.ok(f.writes.every(([, transaction]) => transaction));
  assert.ok(f.accessClients.every(client => f.transactionClients.includes(client)));
});

test('Packing template list-read failures roll back application and stale removals have no committed side effects', async () => {
  const f = fixture({ failListRead: true }), before = structuredClone(f.state);
  await assert.rejects(f.service.applyTemplate('user-a', 'house-a', 'trip-a', { templateId: 'template-a' }), /list read failed/);
  assert.deepEqual(f.state, before);
  await assert.rejects(f.service.removeTripItem('user-a', 'house-a', 'trip-a', 'item-a', 6), status(409)); assert.deepEqual(f.state, before);
});
