#!/usr/bin/env node
'use strict';
// Read-only checks for the collaboration handoff. No network or credentials.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const archive = 'docs/archive/20260831';
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const manifest = JSON.parse(read(`${archive}/manifest.json`));
assert.equal(manifest.documents.length, 8, 'Expected all eight historical design documents');
assert.equal(manifest.layout_revalidated, false, 'Text import must not imply Word layout QA');
for (const entry of manifest.documents) {
  assert.match(entry.source_sha256, /^[0-9a-f]{64}$/);
  assert.equal(digest(fs.readFileSync(path.join(root, archive, entry.markdown))), entry.markdown_sha256, entry.markdown);
  assert.ok(entry.paragraphs > 0 && entry.table_rows > 0 && entry.text_runs > 0, entry.markdown);
}
const pages = ['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'docs/README.md',
  'docs/handoff-20261021.md', 'docs/development-guide.md', 'docs/architecture-and-data.md',
  'docs/requirements-traceability.md', 'docs/bugfix-20261022.md',
  'docs/deployment-20261022.md', 'docs/release-notes-0.1.2.md', 'docs/closure-followup-20261022.md',
  'docs/release-notes-0.1.3.md', 'docs/code-review-20261023.md',
  'docs/design/decisions-20261022.md', 'docs/design/decisions-20261023-review-first.md', `${archive}/README.md`,
  ...manifest.documents.map(entry => `${archive}/${entry.markdown}`)];
let links = 0;
for (const relative of pages) {
  const text = read(relative);
  assert.ok(text.trim().length > 100, `Empty handoff document: ${relative}`);
  for (const match of text.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    let target = match[1].trim().replace(/^<|>$/g, '');
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(target)) continue;
    target = decodeURIComponent(target.split('#')[0]);
    if (!target) continue;
    assert.ok(fs.existsSync(path.resolve(root, path.dirname(relative), target)), `Broken link in ${relative}: ${target}`);
    links++;
  }
  for (const [label, pattern] of [
    ['private key', /-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----/],
    ['GitHub token', /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
    ['Tencent secret ID', /AKID[A-Za-z0-9]{28,}/],
    ['signed credential URL', /(?:q-signature|access_token|refresh_token)=[A-Za-z0-9_%+-]{16,}/i],
  ]) assert.equal(pattern.test(text), false, `Potential ${label} in ${relative}; review without printing the value`);
}
const schema = read('apps/api/prisma/schema.prisma');
const models = [...schema.matchAll(/^model (\w+)\s*\{/gm)].map(match => match[1]);
const migrations = fs.readdirSync(path.join(root, 'apps/api/prisma/migrations'), { withFileTypes: true }).filter(item => item.isDirectory()).length;
const architecture = read('docs/architecture-and-data.md');
const counts = architecture.match(/(\d+)\s*个 Prisma model、(\d+)\s*个增量迁移目录/);
assert.ok(counts, 'Architecture source counts are missing');
assert.equal(Number(counts[1]), models.length);
assert.equal(Number(counts[2]), migrations);
for (const model of models) assert.ok(new RegExp('`' + model + '`').test(architecture), `Model absent from architecture: ${model}`);
const requirements = read('docs/requirements-traceability.md');
for (let index = 1; index <= 14; index++) assert.ok(requirements.includes(`U${String(index).padStart(2, '0')}`), `Missing U${index}`);
// Include staged new files, without inspecting ignored/private workspace files.
// This is a high-confidence pattern check, not proof against every possible secret.
const indexed = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
for (const relative of indexed) {
  assert.equal(/(?:^|\/)(?:\.env(?:\.(?!example$)[^/]*)?|id_rsa[^/]*|id_ed25519[^/]*|[^/]+\.(?:pem|key))$/i.test(relative), false,
    `Private configuration/key filename in index: ${relative}`);
  const contents = fs.readFileSync(path.join(root, relative));
  if (contents.includes(0)) continue;
  const text = contents.toString('utf8');
  for (const [label, pattern] of [
    ['private key', /-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----/],
    ['GitHub token', /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
    ['Tencent secret ID', /AKID[A-Za-z0-9]{28,}/],
    ['signed credential URL', /(?:q-signature|access_token|refresh_token)=[A-Za-z0-9_%+-]{16,}/i],
  ]) assert.equal(pattern.test(text), false, `Potential ${label} in indexed ${relative}; review without printing the value`);
}
console.log(JSON.stringify({ documents: pages.length, localLinks: links, archiveDocuments: manifest.documents.length,
  archivedParagraphs: manifest.documents.reduce((sum, row) => sum + row.paragraphs, 0),
  archivedTableRows: manifest.documents.reduce((sum, row) => sum + row.table_rows, 0), models: models.length, migrations,
  indexedFilesScanned: indexed.length, highConfidenceSecretPatterns: 'no matches', status: 'passed' }, null, 2));
