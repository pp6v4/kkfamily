const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, dependencies, uni = {}) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../src/services', file), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports, uni,
    require(name) {
      if (name in dependencies) return dependencies[name];
      throw new Error('Unexpected import: ' + name);
    },
  });
  return module.exports;
}

function transport() {
  const calls = [];
  const api = load('transport.ts', { './config': { API_BASE_URL: 'https://example.test/api/v1' } }, {
    request(options) {
      calls.push(options);
      options.success({ statusCode: 200, data: { data: { accepted: true } } });
    },
  });
  return { ...api, calls };
}

for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  test(method + ' with omitted JSON data sends a valid empty object, preserving URL and identity', async () => {
    const api = transport();
    const result = await api.rawRequest('/meals/fictional/recalculate?version=7', method, undefined, {
      Authorization: 'Bearer fictional', 'X-Household-Id': 'household-fictional',
    });
    assert.equal(result.accepted, true);
    assert.equal(api.calls.length, 1);
    const sent = api.calls[0];
    assert.equal(sent.method, method === 'PATCH' ? 'POST' : method);
    assert.equal(sent.url, 'https://example.test/api/v1/meals/fictional/recalculate' + (method === 'PATCH' ? '/_patch' : '') + '?version=7');
    assert.equal(sent.header['content-type'], 'application/json');
    assert.equal(sent.header.Authorization, 'Bearer fictional');
    assert.equal(sent.header['X-Household-Id'], 'household-fictional');
    assert.equal(JSON.stringify(sent.data), '{}');
    assert.equal(Object.keys(sent.data).length, 0);
  });
}

for (const method of ['GET', 'HEAD']) {
  test(method + ' with omitted data remains bodyless rather than receiving an empty JSON object', async () => {
    const api = transport();
    await api.rawRequest('/recipes?category=fictional', method);
    assert.equal(api.calls.length, 1);
    assert.equal(api.calls[0].method, method);
    assert.equal(api.calls[0].url, 'https://example.test/api/v1/recipes?category=fictional');
    assert.equal(api.calls[0].data, undefined);
  });
}

for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  test(method + ' preserves explicitly supplied null, scalars, raw strings, objects and arrays', async () => {
    const api = transport();
    const object = { expectedVersion: 7, quantity: null };
    const array = ['fictional', 2];
    const inputs = [null, 0, false, true, 12.5, '', 'raw-string', '"encoded-string"', object, array];
    const expected = ['null', '0', 'false', 'true', '12.5', '', 'raw-string', '"encoded-string"', object, array];
    for (const input of inputs) await api.rawRequest('/resource', method, input);
    assert.equal(api.calls.length, inputs.length);
    for (let index = 0; index < inputs.length; index++) assert.equal(api.calls[index].data, expected[index]);
  });
}

test('GET retains explicitly supplied query data without altering it', async () => {
  const api = transport();
  const query = { page: 2, category: 'fictional' };
  await api.rawRequest('/recipes', 'GET', query);
  assert.equal(api.calls[0].data, query);
});

test('Meal recalculation explicitly supplies an empty object before transport, retaining result and session headers', async () => {
  const calls = [];
  const comparison = [{ key: 'fictional', status: 'UNKNOWN', required: null, onHand: null }];
  const session = { accessToken: 'fictional', householdId: 'household-fictional' };
  const api = load('family-api.ts', {
    './config': { API_BASE_URL: 'https://example.test/api/v1' },
    './session': { getSessionEpoch: () => 0, assertSessionEpoch() {}, ensureSession: async () => session },
    './transport': { rawRequest: async (...args) => { calls.push(args); return comparison; } },
  });
  assert.equal(await api.recalculateMeal('meal-fictional'), comparison);
  assert.equal(calls.length, 1);
  const [endpoint, method, data, headers] = calls[0];
  assert.equal(endpoint, '/meals/meal-fictional/recalculate');
  assert.equal(method, 'POST');
  assert.equal(JSON.stringify(data), '{}');
  assert.equal(headers.Authorization, 'Bearer fictional');
  assert.equal(headers['X-Household-Id'], session.householdId);
});
