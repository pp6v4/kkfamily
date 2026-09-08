require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ForbiddenException } = require('@nestjs/common');
const { NotificationsService } = require('../dist/notifications/notifications.service');

function fixture({ preference = null, taskStatus = 'PENDING', accessError, lock } = {}) {
  const now = new Date('2026-09-10T23:30:00+08:00'), writes = [], permissions = [], isolation = [];
  const job = { id: 'job-a', status: 'PROCESSING', lockedAt: lock || now, channel: 'INBOX', sourceType: 'TASK', sourceId: 'task-a',
    recipientMembershipId: 'member-a', scheduleVersion: 3, eventType: 'TASK_REMINDER', attempts: 0,
    outbox: { householdId: 'house-a' }, recipient: { status: 'ACTIVE', userId: 'user-a' } };
  const tx = {
    notificationJob: { findUnique: async () => job, updateMany: async value => { writes.push(value); return { count: 1 }; }, update: async value => { writes.push(value); return job; } },
    task: { findFirst: async () => ({ version: 3, assigneeMembershipId: 'member-a', status: taskStatus }) },
    notificationPreference: { findUnique: async () => preference },
    inboxItem: { upsert: async value => { writes.push({ inbox: value }); return {}; } },
  };
  const db = { $transaction: async (callback, options) => { isolation.push(options.isolationLevel); return callback(tx); }, notificationJob: tx.notificationJob };
  const access = { require: async (user, household, module, level, client) => {
    assert.equal(client, tx, 'permissions must use the same transaction as delivery');
    permissions.push(module); if (accessError) throw accessError;
    return { id: 'member-a' };
  } };
  return { service: new NotificationsService(db, access, {}), now, writes, permissions, isolation, job };
}

test('Explicit null quiet hours deliver at night in the same transaction as source and permission checks', async () => {
  const f = fixture({ preference: { enabled: true, quietStart: null, quietEnd: null } });
  await f.service.processClaimed('job-a', f.now);
  assert.deepEqual(f.permissions, ['tasks', 'notifications']); assert.deepEqual(f.isolation, ['Serializable']);
  assert.equal(f.writes.filter(row => row.inbox).length, 1); assert.equal(f.writes.at(-1).data.status, 'SENT');
});
test('Absent preference uses default overnight quiet hours and resumes at 08:00 Shanghai', async () => {
  const f = fixture(); await f.service.processClaimed('job-a', f.now);
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].data.status, 'PENDING');
  assert.equal(f.writes[0].data.scheduledAt.toISOString(), '2026-09-11T00:00:00.000Z');
});
test('Completed tasks and withdrawn access cancel the claim without inserting an inbox item', async () => {
  for (const options of [{ taskStatus: 'COMPLETED' }, { accessError: new ForbiddenException('撤权') }]) {
    const f = fixture(options); await f.service.processClaimed('job-a', f.now);
    assert.equal(f.writes.length, 1); assert.equal(f.writes[0].data.status, 'CANCELLED');
    assert.equal(f.writes[0].where.lockedAt.getTime(), f.now.getTime());
  }
});
test('Transient permission lookup failure retries in one minute and stores only the error type', async () => {
  const f = fixture({ accessError: new Error('private connection details') });
  await assert.rejects(f.service.processClaimed('job-a', f.now), /private connection details/);
  assert.equal(f.writes.length, 0);
  await f.service.retryOrFail('job-a', f.now, new Error('private connection details'));
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].data.status, 'PENDING');
  assert.equal(f.writes[0].data.attempts, 1); assert.equal(f.writes[0].data.lastError, 'Error');
  assert.equal(f.writes[0].data.scheduledAt.getTime(), f.now.getTime() + 60000);
});
test('An expired worker claim cannot deliver or overwrite a newer worker retry state', async () => {
  const f = fixture({ lock: new Date('2026-09-10T23:36:00+08:00') });
  await f.service.processClaimed('job-a', f.now); await f.service.retryOrFail('job-a', f.now, new Error('old worker'));
  assert.equal(f.writes.length, 0); assert.equal(f.permissions.length, 0);
});
test('Exhausted retries fail the current claim without rescheduling it', async () => {
  const f = fixture(); f.job.attempts = 3;
  await f.service.retryOrFail('job-a', f.now, new Error('temporary'));
  assert.equal(f.writes[0].data.status, 'FAILED'); assert.equal(f.writes[0].data.attempts, 4);
  assert.equal(f.writes[0].data.scheduledAt, undefined); assert.equal(f.writes[0].where.lockedAt, f.now);
});
