const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { run } = require('./verify-database.cjs');
const { assertIsolatedDatabase } = require('../apps/api/test/run-isolated.cjs');

const safe = `postgresql://verify:${'a'.repeat(64)}@kk-verify-db-0123456789abcdef:5432/verify?schema=public`;
test('Database guard rejects production, loopback, wrong users, paths and ambiguous query parameters', () => {
  assert.doesNotThrow(() => assertIsolatedDatabase(safe));
  for (const value of [undefined, '', safe.replace('kk-verify-db-0123456789abcdef', '49.233.18.181'),
    safe.replace('kk-verify-db-0123456789abcdef', 'localhost'), safe.replace('/verify?', '/family_life?'),
    safe.replace('://verify:', '://postgres:'), safe.replace(':5432/', ':5433/'),
    safe + '&host=production', safe + '#production', safe.replace('schema=public', 'schema=private')]) {
    assert.throws(() => assertIsolatedDatabase(value), undefined, String(value));
  }
});
test('Verification never starts containers after a build failure and records the failed phase', async () => {
  const calls = [];
  const result = await run(async args => { calls.push(args); return args.includes('build') ? 9 : 0; });
  assert.equal(result.code, 9); assert.equal(result.report.status, 'failed');
  assert.equal(calls.some(args => args.includes('up')), false);
  const recorded = JSON.parse(readFileSync(path.join(result.output, 'result.json'), 'utf8'));
  assert.equal(recorded.phases.at(-1).phase, 'build'); assert.equal(recorded.phases.at(-1).exitCode, 9);
  assert.ok(recorded.finishedAt);
});
test('Verification uses one unique isolated project, preserves test failure and excludes secrets from evidence', async () => {
  const calls = []; let password;
  const result = await run(async (args, env) => { calls.push(args); password = env.VERIFY_DB_PASSWORD; return args.includes('up') ? 1 : 0; });
  assert.equal(result.code, 1); assert.equal(result.report.status, 'failed');
  const composeCalls = calls.filter(args => args.includes('-f'));
  assert.equal(composeCalls.length, 3);
  for (const args of composeCalls) {
    assert.equal(args[args.indexOf('-p') + 1], result.report.project);
    assert.match(args[args.indexOf('-f') + 1], /verification[\\/]compose.yml$/);
    assert.match(args[args.indexOf('--env-file') + 1], /verification[\\/]empty.env$/);
  }
  assert.deepEqual(calls.at(-1).slice(-4), ['up', '--abort-on-container-exit', '--exit-code-from', 'verify']);
  assert.equal(readFileSync(path.join(result.output, 'result.json'), 'utf8').includes(password), false);
  assert.equal(calls.some(args => args.includes('down') || args.includes('--volumes')), false);
});
