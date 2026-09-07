const { spawn, spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { mkdirSync, appendFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function docker(args, env, logFile) {
  return new Promise(resolve => {
    const child = spawn('docker', args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => {
      appendFileSync(logFile, data); process.stdout.write(data);
    });
    child.once('error', error => {
      appendFileSync(logFile, `Docker could not start: ${error.code || error.name}\n`);
      resolve(1);
    });
    child.once('close', code => resolve(code ?? 1));
  });
}

async function run(execDocker = docker) {
  const id = randomBytes(8).toString('hex');
  const project = `kk-verify-${id}`;
  const output = path.join(root, '.codex-tmp', 'db-verification', id);
  mkdirSync(output, { recursive: true });
  const env = { ...process.env, VERIFY_RUN_ID: id, VERIFY_DB_PASSWORD: randomBytes(32).toString('hex') };
  const base = ['compose', '--env-file', path.join(root, 'infra/verification/empty.env'), '-p', project,
    '-f', path.join(root, 'infra/verification/compose.yml')];
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true });
  const changes = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', windowsHide: true });
  const report = { project, mode: execDocker === docker ? 'docker' : 'simulated',
    sourceRevision: revision.status === 0 ? revision.stdout.trim() : null,
    worktreeStatus: changes.status === 0 ? changes.stdout.trim() : null,
    startedAt: new Date().toISOString(), finishedAt: null, status: 'running', phases: [] };
  const reportFile = path.join(output, 'result.json');
  const record = () => writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
  record();
  const steps = [
    ['docker', ['version', '--format', '{{.Server.Version}}']],
    ['compose', ['compose', 'version']],
    ['config', [...base, 'config', '--quiet']],
    ['build', [...base, 'build', 'verify']],
    ['database-and-tests', [...base, 'up', '--abort-on-container-exit', '--exit-code-from', 'verify']],
  ];
  try {
    for (const [phase, args] of steps) {
      const startedAt = new Date().toISOString();
      const code = await execDocker(args, env, path.join(output, `${phase}.log`));
      report.phases.push({ phase, startedAt, finishedAt: new Date().toISOString(), exitCode: code });
      record();
      if (code !== 0) { report.status = 'failed'; return { code, report, output }; }
    }
    report.status = 'passed';
    return { code: 0, report, output };
  } finally {
    report.finishedAt = new Date().toISOString();
    if (report.status === 'running') report.status = 'interrupted';
    record();
    console.log(`Verification evidence: ${output}`);
    console.log(`Isolated Compose project: ${project}`);
  }
}

if (require.main === module) run().then(result => { process.exitCode = result.code; }).catch(error => {
  console.error(error.message); process.exitCode = 1;
});
module.exports = { run };
