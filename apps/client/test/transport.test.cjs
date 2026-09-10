const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function transport(respond) {
  const exports = {}, calls = [];
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/transport.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(code, { exports, require: () => ({ API_BASE_URL: 'https://pp6v4.com/api/v1' }), uni: { request(options) { calls.push(options); respond(options); } } });
  return { ...exports, calls };
}
test('PATCH uses the explicit POST alias and preserves query, version, body and identity headers', async () => {
  const api = transport(options => options.success({ statusCode: 200, data: { data: { version: 8 } } }));
  const data = { status: 'PUBLISHED', expectedVersion: 7 };
  const result = await api.rawRequest('/recipes/a/status?note=%E5%AE%B6', 'PATCH', data, { Authorization: 'Bearer fictional', 'X-Household-Id': 'home' });
  assert.equal(result.version, 8); const sent = api.calls[0];
  assert.equal(sent.method, 'POST'); assert.equal(sent.url, 'https://pp6v4.com/api/v1/recipes/a/status/_patch?note=%E5%AE%B6');
  assert.equal(sent.data, data); assert.equal(sent.header.Authorization, 'Bearer fictional'); assert.equal(sent.header['X-Household-Id'], 'home');
  assert.equal(sent.header['content-type'], 'application/json'); assert.equal(sent.header['X-HTTP-Method-Override'], undefined);
});
test('Normal requests and binary uploads retain methods, URLs and bytes', async () => {
  const api = transport(options => options.success({ statusCode: 200, data: { data: null } }));
  for (const method of ['GET', 'POST', 'PUT', 'DELETE']) assert.equal(await api.rawRequest('/resource', method), null);
  const bytes = new Uint8Array([0, 127, 255]).buffer;
  await api.rawBinaryRequest('/media/id/content', 'PUT', bytes, 'image/png');
  assert.deepEqual(api.calls.map(value => value.method), ['GET', 'POST', 'PUT', 'DELETE', 'PUT']);
  assert.equal(api.calls[4].data, bytes); assert.equal(api.calls[4].header['content-type'], 'image/png');
  assert.equal(api.calls[4].url, 'https://pp6v4.com/api/v1/media/id/content');
});
test('HTTP errors preserve status for auth renewal and version conflict; no automatic mutation retry', async () => {
  for (const statusCode of [401, 403, 409, 500]) {
    const api = transport(options => options.success({ statusCode, data: { message: ['first', 'second'] } }));
    await assert.rejects(api.rawRequest('/recipes/a', 'PATCH', { expectedVersion: 1 }), error => error.statusCode === statusCode && error.message === 'first；second');
    assert.equal(api.calls.length, 1);
  }
});
test('Malformed success envelopes reject instead of hanging or reporting a successful save', async () => {
  for (const data of [null, undefined, 'HTML page', {}, new ArrayBuffer(1)]) {
    const api = transport(options => options.success({ statusCode: 200, data }));
    await assert.rejects(api.rawRequest('/recipes/a', 'PATCH'), error => error.statusCode === 502);
    await assert.rejects(api.rawBinaryRequest('/media/id', 'PUT', new ArrayBuffer(1), 'image/png'), error => error.statusCode === 502);
  }
});
test('Network failure is explicit and is not silently retried', async () => {
  const api = transport(options => options.fail({ errMsg: 'request:fail offline' }));
  await assert.rejects(api.rawRequest('/recipes/a', 'PATCH'), error => error.statusCode === 0 && error.message.includes('offline'));
  assert.equal(api.calls.length, 1);
});
