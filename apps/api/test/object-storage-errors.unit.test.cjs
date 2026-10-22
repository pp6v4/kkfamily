require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const ts = require('typescript');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });

const filename = path.resolve(__dirname, '../src/media/object-storage.service.ts');
const sourceRequire = createRequire(filename);
const key = 'households/house-a/recipes/recipe-a/12345678-1234-1234-1234-123456789012.png';
const body = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const checksum = createHash('sha256').update(body).digest('hex');
const unconfigured = '图片存储尚未配置';
const unavailable = '图片存储暂时不可用，请稍后重试';
const uploadFailed = '图片上传失败，请稍后重试';
const config = values => ({ get: name => values[name], getOrThrow: name => { if (!values[name]) throw Error('missing'); return values[name]; } });

// Compile only this current source module in memory. COS calls are injected;
// mounted guards use their current source via ts-node, never stale dist output.
function fixture(values = {}, cosClient = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true, emitDecoratorMetadata: true } });
  const module = { exports: {} };
  class FakeCosSdk { constructor() { Object.assign(this, cosClient); } }
  const execute = vm.compileFunction(compiled.outputText, ['exports', 'require', 'module'], { filename });
  execute(module.exports, name => name === 'cos-nodejs-sdk-v5' ? FakeCosSdk : sourceRequire(name), module);
  const service = new module.exports.ObjectStorageService(config(values)), logs = [];
  service.logger = { error: message => logs.push(message) };
  return { service, logs };
}
function is503(message) {
  return error => { assert.equal(error.getStatus(), 503); assert.equal(error.message, message); assert.deepEqual(error.getResponse(), { message, error: 'Service Unavailable', statusCode: 503 }); return true; };
}

test('Only disabled or absent driver reports unconfigured storage, preserving 503 and making no backend writes', async () => {
  for (const values of [{}, { MEDIA_DRIVER: 'disabled' }]) {
    const { service, logs } = fixture(values);
    assert.throws(() => service.assertAvailable(), is503(unconfigured));
    await assert.rejects(service.put(key, body, 'image/png', checksum), is503(unconfigured));
    await assert.rejects(service.head(key, checksum), is503(unconfigured));
    await assert.rejects(service.get(key, checksum), is503(unconfigured));
    assert.deepEqual(logs, []); assert.equal(service.memory.size, 0);
  }
});

test('Configured mounted EIO is an upload failure, logged as safe code once with no retry or memory fallback', async () => {
  const { service, logs } = fixture({ MEDIA_DRIVER: 'mounted', MEDIA_MOUNT_ROOT: '/does-not-exist-family-life-mount-test' });
  let puts = 0;
  service.mounted = { assertAvailable() {}, put: async () => { puts++; throw Object.assign(new Error('DO_NOT_LEAK /private/mount/secret'), { code: 'EIO' }); } };
  service.assertAvailable();
  await assert.rejects(service.put(key, body, 'image/png', checksum), is503(uploadFailed));
  assert.equal(puts, 1); assert.deepEqual(logs, ['Mounted put failed: EIO']); assert.equal(service.memory.size, 0);
});

test('A configured missing mount stays closed and reports temporary failure instead of missing configuration', async () => {
  const root = '/does-not-exist-family-life-mount-test'; assert.equal(fs.existsSync(root), false);
  const { service, logs } = fixture({ MEDIA_DRIVER: 'mounted', MEDIA_MOUNT_ROOT: root });
  assert.throws(() => service.assertAvailable(), is503(unavailable));
  await assert.rejects(service.put(key, body, 'image/png', checksum), is503(uploadFailed));
  await assert.rejects(service.head(key, checksum), is503(unavailable));
  await assert.rejects(service.get(key, checksum), is503(unavailable));
  assert.deepEqual(logs, ['Mounted availability failed: unknown', 'Mounted put failed: unknown', 'Mounted head failed: unknown', 'Mounted get failed: unknown']);
  assert.equal(fs.existsSync(root), false); assert.equal(service.memory.size, 0);
});

test('Configured mounted read and confirmation errors retain 503 without exposing paths or exception messages', async () => {
  const { service, logs } = fixture({ MEDIA_DRIVER: 'mounted', MEDIA_MOUNT_ROOT: '/does-not-exist-family-life-mount-test' });
  let reads = 0; service.mounted = { get: async () => { reads++; throw Object.assign(new Error('DO_NOT_LEAK /private/object'), { code: 'EIO' }); } };
  await assert.rejects(service.head(key, checksum), is503(unavailable)); await assert.rejects(service.get(key, checksum), is503(unavailable));
  assert.equal(reads, 2); assert.deepEqual(logs, ['Mounted head failed: EIO', 'Mounted get failed: EIO']); assert.equal(service.memory.size, 0);
});

test('Configured COS backend exceptions are safe operational 503 responses with no blind retry', async () => {
  const calls = [];
  const backend = Object.fromEntries(['putObject', 'headObject', 'getObject'].map(name => [name, async () => { calls.push(name); throw Object.assign(new Error('DO_NOT_LEAK fictional-secret'), { code: 'InternalError' }); }]));
  const { service, logs } = fixture({ MEDIA_DRIVER: 'cos', COS_BUCKET: 'fictional-bucket', COS_REGION: 'fictional-region', COS_SECRET_ID: 'fictional-id', COS_SECRET_KEY: 'fictional-key' }, backend);
  service.assertAvailable();
  await assert.rejects(service.put(key, body, 'image/png', checksum), is503(uploadFailed)); await assert.rejects(service.head(key, checksum), is503(unavailable)); await assert.rejects(service.get(key, checksum), is503(unavailable));
  assert.deepEqual(calls, ['putObject', 'headObject', 'getObject']); assert.deepEqual(logs, ['COS putObject failed: InternalError', 'COS headObject failed: InternalError', 'COS getObject failed: InternalError']); assert.equal(service.memory.size, 0);
});

test('Unexpected error codes cannot inject paths, messages or object coercion into storage logs', async () => {
  for (const code of ['EIO\nDO_NOT_LEAK', '/private/mount', 'x'.repeat(65), { toString() { throw new Error('must not coerce'); } }]) {
    const { service, logs } = fixture({ MEDIA_DRIVER: 'mounted', MEDIA_MOUNT_ROOT: '/does-not-exist-family-life-mount-test' });
    service.mounted = { put: async () => { throw Object.assign(new Error('DO_NOT_LEAK /private/object'), { code }); } };
    await assert.rejects(service.put(key, body, 'image/png', checksum), is503(uploadFailed)); assert.deepEqual(logs, ['Mounted put failed: unknown']);
  }
});

test('A missing object in configured test memory is unavailable, while successful memory storage stays exact', async () => {
  const { service, logs } = fixture({ MEDIA_DRIVER: 'memory', NODE_ENV: 'test' });
  await assert.rejects(service.head(key, checksum), is503(unavailable)); await assert.rejects(service.get(key, checksum), is503(unavailable));
  await service.put(key, body, 'image/png', checksum); assert.deepEqual(await service.head(key, checksum), { bytes: body.length, mimeType: 'image/png', checksumSha256: checksum });
  assert.deepEqual(await service.get(key, checksum), { body, mimeType: 'image/png' }); assert.deepEqual(logs, []);
});
