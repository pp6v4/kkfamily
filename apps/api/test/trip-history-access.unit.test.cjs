require('reflect-metadata');
require('ts-node').register({ transpileOnly: true, compilerOptions: { incremental: false } });
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ForbiddenException } = require('@nestjs/common');
const { TripsService } = require('../src/trips/trips.service');

const leftAt = new Date('2026-10-20T09:00:00.000Z');
function fixture(options = {}) {
  const trip = { id: 'trip-a', householdId: 'house-a', status: options.status || 'COMPLETED', version: 8 };
  const actor = { membershipId: 'owner-a', tripRole: 'OWNER', status: 'HISTORY', canEdit: true, photoAdd: true, version: 3, leftAt, ...options.actor };
  const target = { membershipId: 'friend-a', tripRole: 'MEMBER', status: 'HISTORY', canEdit: false, photoAdd: true, version: 5, leftAt, ...options.target };
  const writes = [], reads = [];
  const tx = {
    tripMember: {
      findFirst: async input => { reads.push(['actor', input]); return options.missingActor ? null : { ...actor, trip }; },
      findUnique: async input => { reads.push(['target', input]); return { ...target }; },
      count: async input => { reads.push(['owners', input]); return options.otherOwners ?? 1; },
      update: async input => { writes.push(['member', input]); Object.assign(target, input.data, { version: target.version + 1 }); },
    },
    tripPackingItem: {
      count: async input => { reads.push(['packing', input]); return 2; },
      updateMany: async input => { writes.push(['packing', input]); return { count: 2 }; },
    },
    tripPreparationGroupMember: { deleteMany: async input => { writes.push(['group', input]); return { count: 1 }; } },
    auditLog: { create: async input => { writes.push(['audit', input]); return input.data; } },
    trip: { findFirst: async () => ({ ...trip, members: [actor, target].filter(row => row.status !== 'REVOKED') }) },
  };
  const prisma = { ...tx, $transaction: async (callback, transactionOptions) => {
    assert.equal(transactionOptions.isolationLevel, 'Serializable'); return callback(tx);
  } };
  const access = { require: async (...args) => {
    assert.deepEqual(args.slice(0, 4), ['user-a', 'house-a', 'trips', 'EDIT']);
    assert.ok(args[4] === tx || args[4] === prisma);
    if (options.moduleViewOnly) throw new ForbiddenException('只读模块权限');
    return { id: actor.membershipId };
  } };
  return { service: new TripsService(prisma, access), writes, reads, target, actor };
}
const update = (f, data, targetId = 'friend-a') => f.service.updateMember('user-a', 'house-a', 'trip-a', targetId, { expectedVersion: 5, ...data });

test('Completed-trip owner can revoke history access without changing completed packing or group snapshots', async () => {
  const f = fixture(); const result = await update(f, { status: 'REVOKED' });
  assert.deepEqual(f.writes.map(row => row[0]), ['member', 'audit']);
  assert.equal(f.reads.some(row => row[0] === 'packing'), false);
  assert.equal(f.target.status, 'REVOKED'); assert.ok(f.target.leftAt > leftAt);
  assert.equal(f.target.photoAdd, true); assert.equal(f.target.canEdit, false);
  assert.equal(result.data.members.some(row => row.membershipId === 'friend-a'), false);
  assert.equal(f.writes[1][1].data.action, 'TRIP_MEMBER_UPDATE');
  assert.deepEqual(f.writes[1][1].data.details, {
    membershipId:'friend-a',status:'REVOKED',role:'MEMBER',fromVersion:5,toVersion:6,
    before:{photoAdd:true,canEdit:false},after:{photoAdd:true,canEdit:false},
  });
});

test('Closing history photo permission preserves membership, historical date, role and completed snapshots', async () => {
  const f = fixture(); const result = await update(f, { photoAdd: false });
  assert.deepEqual(f.writes.map(row => row[0]), ['member', 'audit']);
  assert.equal(f.target.status, 'HISTORY'); assert.equal(f.target.leftAt, leftAt);
  assert.equal(f.target.tripRole, 'MEMBER'); assert.equal(f.target.canEdit, false);
  assert.equal(f.target.photoAdd, false); assert.equal(f.target.version, 6);
  assert.equal(result.data.members.length, 2);
  assert.deepEqual(f.writes[1][1].data.details, {
    membershipId:'friend-a',status:'HISTORY',role:'MEMBER',fromVersion:5,toVersion:6,
    before:{photoAdd:true,canEdit:false},after:{photoAdd:false,canEdit:false},
  });
});

test('Cancelled-trip existing active or history owner can reduce access while preserving cancelled business records', async () => {
  for (const status of ['ACTIVE', 'HISTORY']) {
    for (const data of [{ status: 'REVOKED' }, { photoAdd: false }]) {
      const historicalLeftAt=status==='ACTIVE'?null:leftAt;
      const f = fixture({ status: 'CANCELLED', actor: { status,leftAt:historicalLeftAt }, target: { status,leftAt:historicalLeftAt } });
      await update(f, data);
      assert.deepEqual(f.writes.map(row => row[0]), ['member', 'audit']);
      assert.equal(f.reads.some(row => row[0] === 'packing'), false);
      assert.equal(f.target.status, data.status || status);
      assert.equal(f.target.photoAdd, data.photoAdd ?? true);
      if (data.photoAdd === false) assert.equal(f.target.leftAt, historicalLeftAt);
    }
  }
});

test('Completed-trip access reduction cannot grant editing, restore activity, change roles or regrant photos', async () => {
  for (const status of ['COMPLETED', 'CANCELLED']) for (const data of [{}, { photoAdd: true }, { canEdit: true }, { canEdit: false, photoAdd: false },
    { status: 'ACTIVE' }, { tripRole: 'OWNER' }, { tripRole: 'MEMBER', status: 'REVOKED' },
    { photoAdd: false, clearResponsibilities: true }]) {
    const f = fixture({ status }); await assert.rejects(update(f, data), error => error.getStatus() === 409, JSON.stringify({ status, data }));
    assert.equal(f.writes.length, 0, JSON.stringify(data));
  }
});

test('History access management requires an authorized owner and rejects stale targets and revoked targets', async () => {
  for (const [options, status] of [
    [{ actor: { tripRole: 'MEMBER' } }, 403], [{ actor: { canEdit: false } }, 403],
    [{ actor: { status: 'REVOKED' }, missingActor: true }, 403], [{ moduleViewOnly: true }, 403],
    [{ actor: { status: 'ACTIVE' } }, 403],
    [{ status: 'PENDING' }, 403], [{ target: { version: 6 } }, 409],
    [{ target: { status: 'REVOKED' } }, 404],
  ]) {
    const f = fixture(options); await assert.rejects(update(f, { photoAdd: false }), error => error.getStatus() === status, JSON.stringify(options));
    assert.equal(f.writes.length, 0);
  }
});

test('Last history owner cannot be revoked; another nonrevoked history owner satisfies the owner invariant', async () => {
  for (const otherOwners of [0, 1]) {
    const f = fixture({ actor: { version:5 }, target: { membershipId:'owner-a', tripRole: 'OWNER', canEdit: true }, otherOwners });
    if (!otherOwners) { await assert.rejects(update(f, { status: 'REVOKED' }, 'owner-a'), error => error.getStatus() === 409); assert.equal(f.writes.length, 0); }
    else { await update(f, { status: 'REVOKED' }, 'owner-a'); assert.equal(f.target.status, 'REVOKED'); }
    const query = f.reads.find(row => row[0] === 'owners')[1].where;
    assert.deepEqual(query.status, { in: ['ACTIVE', 'HISTORY'] });
    assert.equal(query.tripRole, 'OWNER'); assert.equal(query.canEdit, true);
    assert.equal(query.membershipId.not, 'owner-a');
  }
});

test('Completed history permissions do not open invitations, group writes or itinerary editing', async () => {
  for (const status of ['COMPLETED', 'CANCELLED']) for (const method of ['addMember', 'createGroup', 'updateGroup', 'update', 'updateStatus', 'candidates']) {
    const f = fixture({ status, actor: { status: status === 'COMPLETED' ? 'HISTORY' : 'ACTIVE' } }); const args = ['user-a', 'house-a', 'trip-a'];
    if (method === 'updateGroup') args.push('group-a');
    args.push({ expectedVersion: 8, membershipId: 'new-member', name: '新组', membershipIds: [], title: '改行程', status: 'PENDING' });
    await assert.rejects(f.service[method](...args), error => error.getStatus() === (status === 'COMPLETED' ? 403 : 409), method);
    assert.equal(f.writes.length, 0, method);
  }
});
