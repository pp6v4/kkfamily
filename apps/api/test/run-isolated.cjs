const { spawnSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const path = require('node:path');

function assertIsolatedDatabase(value) {
  const url = new URL(value || 'invalid:');
  if (url.protocol !== 'postgresql:' || url.username !== 'verify' ||
      !/^kk-verify-db-[a-f0-9]{16}$/.test(url.hostname) || url.port !== '5432' ||
      url.pathname !== '/verify' || !/^[a-f0-9]{64}$/.test(url.password) ||
      url.search !== '?schema=public' || url.hash) {
    throw new Error('Refusing to migrate outside the isolated verification database');
  }
}

function main() {
  assertIsolatedDatabase(process.env.DATABASE_URL);
  if (process.env.NODE_ENV !== 'test' || process.env.MEDIA_DRIVER !== 'memory') {
    throw new Error('Verification requires NODE_ENV=test and MEDIA_DRIVER=memory');
  }
  const migrations = readdirSync(path.join(__dirname, '../prisma/migrations'), { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  console.log(JSON.stringify({ phase: 'migrations', count: migrations.length, names: migrations }));
  const steps = [
    ['migrate-deploy', [require.resolve('prisma/build/index.js'), 'migrate', 'deploy']],
    ['migrate-status', [require.resolve('prisma/build/index.js'), 'migrate', 'status']],
    ['http-integration', ['--test', '--test-reporter=tap', 'test/access.integration.test.cjs']],
  ];
  for (const [phase, args] of steps) {
    console.log(JSON.stringify({ phase, state: 'started' }));
    const result = spawnSync(process.execPath, args, { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
    const exitCode = result.status ?? 1;
    console.log(JSON.stringify({ phase, state: exitCode === 0 ? 'passed' : 'failed', exitCode }));
    if (exitCode !== 0) { process.exitCode = exitCode; return; }
  }
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { assertIsolatedDatabase };
