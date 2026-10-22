require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { TasksService } = require('../src/tasks/tasks.service.ts');

function fixture({ manager = true, actorId = 'member-a', assigneeId = 'inactive-person', status = 'PENDING', failAudit = false, failVersionWrite = false } = {}) {
  let state = {
    task: { id: 'task-a', householdId: 'house-a', archivedAt: null, version: 6, type: 'TODO', title: '清洗空调', description: '旧说明',
      createdById: 'member-a', assigneeMembershipId: assigneeId, status, priority: 'NORMAL',
      dueAt: new Date('2026-10-25T07:30:00.123Z'), reminderAt: new Date('2026-10-24T04:15:00.456Z') },
    history: [], audits: [], notifications: [],
  };
  const writes = [], membershipReads = [], taskReads = [], accessCalls = [], isolation = [];
  const matches = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
  const tx = {
    task: {
      findFirst: async input => { taskReads.push(input.where); return matches(state.task, input.where) ? structuredClone(state.task) : null; },
      updateMany: async input => {
        writes.push(['task', structuredClone(input)]);
        if (failVersionWrite || !matches(state.task, input.where)) return { count: 0 };
        for (const [key, value] of Object.entries(input.data)) if (value !== undefined) state.task[key] = key === 'version' ? state.task.version + value.increment : structuredClone(value);
        return { count: 1 };
      },
    },
    membership: { findFirst: async input => {
      membershipReads.push(input.where);
      const people = [{ id: 'active-person', householdId: 'house-a', status: 'ACTIVE' }, { id: 'inactive-person', householdId: 'house-a', status: 'DISABLED' }, { id: 'foreign-person', householdId: 'house-b', status: 'ACTIVE' }];
      return people.find(person => matches(person, input.where)) || null;
    } },
    taskHistory: { create: async input => { writes.push(['history', structuredClone(input)]); state.history.push(structuredClone(input.data)); } },
    auditLog: { create: async input => { writes.push(['audit', structuredClone(input)]); if (failAudit) throw new Error('audit failed'); state.audits.push(structuredClone(input.data)); } },
  };
  const prisma = { $transaction: async (action, options) => {
    isolation.push(options.isolationLevel);
    const before = structuredClone(state);
    try { return await action(tx); } catch (error) { state = before; throw error; }
  } };
  const access = { require: async (...args) => { accessCalls.push(args.slice(0, 4)); assert.equal(args[4], tx); return { id: actorId, effectivePermissions: { tasks: manager ? 'MANAGE' : 'EDIT' } }; } };
  const notifications = { syncTask: async (db, task) => { assert.equal(db, tx); writes.push(['notifications', task.id]); state.notifications.push(structuredClone(task)); } };
  return { service: new TasksService(prisma, access, notifications), get state() { return state; }, writes, membershipReads, taskReads, accessCalls, isolation };
}
const update = (f, input = {}, householdId = 'house-a') => f.service.update('user-a', householdId, 'task-a', { expectedVersion: 6, title: '清洗客厅空调', ...input });

test('Task update preserves an inactive original assignee when omitted or explicitly unchanged, and clears description to null', async () => {
  for (const input of [{}, { assigneeMembershipId: 'inactive-person' }]) {
    const f = fixture(), before = structuredClone(f.state.task);
    const result = await update(f, { ...input, description: '   ' });
    assert.equal(result.data.description, null); assert.equal(result.data.title, '清洗客厅空调');
    assert.equal(result.data.assigneeMembershipId, 'inactive-person'); assert.equal(result.data.version, 7);
    assert.deepEqual(result.data.dueAt, before.dueAt); assert.deepEqual(result.data.reminderAt, before.reminderAt);
    assert.deepEqual(f.membershipReads, []);
    assert.deepEqual(f.accessCalls, [['user-a', 'house-a', 'tasks', 'EDIT']]); assert.deepEqual(f.isolation, ['Serializable']);
    assert.ok(f.taskReads.every(where => where.id === 'task-a' && where.householdId === 'house-a' && where.archivedAt === null));
    const write = f.writes.find(([kind]) => kind === 'task')[1];
    assert.deepEqual(write.where, { id: 'task-a', householdId: 'house-a', archivedAt: null, version: 6 });
    assert.equal(f.state.history.length, 1); assert.equal(f.state.notifications.length, 1); assert.equal(f.state.notifications[0].version, 7);
    assert.equal(f.state.audits[0].action, 'TASK_UPDATE'); assert.deepEqual(f.state.audits[0].details, { fromVersion: 6, toVersion: 7 });
  }
});

test('Task update preserves null assignment and omitted descriptions without revalidation', async () => {
  for (const input of [{}, { assigneeMembershipId: null }]) {
    const f = fixture({ assigneeId: null });
    const result = await update(f, input);
    assert.equal(result.data.assigneeMembershipId, null); assert.equal(result.data.description, '旧说明');
    assert.deepEqual(f.membershipReads, []);
  }
});

test('Task manager reassignment requires an active person in the same household; explicit unassignment is allowed', async () => {
  const active = fixture();
  const changed = await update(active, { assigneeMembershipId: 'active-person' });
  assert.equal(changed.data.assigneeMembershipId, 'active-person');
  assert.deepEqual(active.membershipReads, [{ id: 'active-person', householdId: 'house-a', status: 'ACTIVE' }]);
  const cleared = fixture(); assert.equal((await update(cleared, { assigneeMembershipId: null })).data.assigneeMembershipId, null);
  for (const assigneeMembershipId of ['inactive-person', 'foreign-person', 'missing-person']) {
    const f = fixture({ assigneeId: 'active-person' }), before = structuredClone(f.state);
    await assert.rejects(update(f, { assigneeMembershipId }), error => error.getStatus() === 400);
    assert.deepEqual(f.state, before); assert.deepEqual(f.writes, []);
  }
});

test('Ordinary editors keep assignment only within their existing content-edit authority and never reassign', async () => {
  for (const input of [{}, { assigneeMembershipId: 'inactive-person' }]) {
    const f = fixture({ manager: false });
    assert.equal((await update(f, input)).data.assigneeMembershipId, 'inactive-person'); assert.deepEqual(f.membershipReads, []);
  }
  const assigned = fixture({ manager: false, actorId: 'member-b', assigneeId: 'member-b', status: 'IN_PROGRESS' });
  assert.equal((await update(assigned)).data.assigneeMembershipId, 'member-b');
  for (const assigneeMembershipId of ['active-person', null]) {
    const f = fixture({ manager: false }), before = structuredClone(f.state);
    await assert.rejects(update(f, { assigneeMembershipId }), error => error.getStatus() === 403);
    assert.deepEqual(f.state, before); assert.deepEqual(f.writes, []); assert.deepEqual(f.membershipReads, []);
  }
  for (const options of [{ actorId: 'unrelated-person' }, { status: 'IN_PROGRESS' }]) {
    const f = fixture({ manager: false, ...options }), before = structuredClone(f.state);
    await assert.rejects(update(f), error => error.getStatus() === 403);
    assert.deepEqual(f.state, before); assert.deepEqual(f.writes, []);
  }
});

test('Task update rejects stale versions, failed version writes and foreign households without changing state', async () => {
  for (const [options, input, householdId, status] of [[{}, { expectedVersion: 5 }, 'house-a', 409], [{ failVersionWrite: true }, {}, 'house-a', 409], [{}, {}, 'house-b', 404]]) {
    const f = fixture(options), before = structuredClone(f.state);
    await assert.rejects(update(f, input, householdId), error => error.getStatus() === status);
    assert.deepEqual(f.state, before); assert.deepEqual(f.membershipReads, []);
    assert.ok(f.writes.every(([kind]) => kind === 'task'));
  }
});

test('Task audit failure rolls back content, version, assignment, history and notification changes together', async () => {
  const f = fixture({ failAudit: true }), before = structuredClone(f.state);
  await assert.rejects(update(f, { assigneeMembershipId: 'active-person', description: '' }), /audit failed/);
  assert.deepEqual(f.state, before); assert.deepEqual(f.isolation, ['Serializable']);
  assert.deepEqual(f.writes.map(([kind]) => kind), ['task', 'history', 'notifications', 'audit']);
});
