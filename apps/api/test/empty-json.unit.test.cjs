const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
require('reflect-metadata');
const { Test } = require('@nestjs/testing');
const { ValidationPipe, ForbiddenException, NotFoundException } = require('@nestjs/common');
const { FastifyAdapter } = require('@nestjs/platform-fastify');
const { JwtService } = require('@nestjs/jwt');
const { MealsController } = require('../dist/meals/meals.controller');
const { MealsService } = require('../dist/meals/meals.service');
const { configurePatchCompatibility } = require('../dist/common/patch-compatibility');

function compatibility() {
  const module = { exports: {} };
  const filename = path.resolve(__dirname, '../src/common/empty-json-compatibility.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require });
  return module.exports.configureEmptyJsonCompatibility;
}

async function fixture(t, enabled = true) {
  const calls = [];
  const jwt = new JwtService({ secret: 'fictional-empty-json-regression-only' });
  const service = {
    recalculate(userId, householdId, mealId, snapshotVersion) {
      calls.push({ userId, householdId, mealId, snapshotVersion });
      if (householdId !== 'household-fixture') throw new ForbiddenException('Household denied');
      if (userId === 'no-inventory') throw new ForbiddenException('Inventory permission denied');
      if (mealId !== 'meal-fixture') throw new NotFoundException('Meal not found');
      return { data: [{ key: 'fixture', status: 'UNKNOWN', required: null }] };
    },
    create() { calls.push('create'); return { data: {} }; },
    transition() { calls.push('transition'); return { data: {} }; },
    removeItem() { calls.push('removeItem'); return { data: {} }; },
  };
  const module = await Test.createTestingModule({ controllers: [MealsController], providers: [
    { provide: MealsService, useValue: service }, { provide: JwtService, useValue: jwt },
  ] }).compile();
  const app = module.createNestApplication(new FastifyAdapter(), { logger: false });
  if (enabled) compatibility()(app);
  configurePatchCompatibility(app);
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init(); await app.getHttpAdapter().getInstance().ready();
  t.after(() => app.close());
  const headers = { authorization: 'Bearer ' + await jwt.signAsync({ sub: 'user-fixture' }),
    'x-household-id': 'household-fixture', 'content-type': 'application/json' };
  return { app, calls, headers, jwt };
}

test('Baseline reproduces released 0.1.2 empty JSON failure before the guarded handler', async t => {
  const { app, calls, headers } = await fixture(t, false);
  const response = await app.inject({ method: 'POST', url: '/v1/meals/meal-fixture/recalculate', headers });
  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /Body cannot be empty/);
  assert.equal(calls.length, 0);
});

for (const length of [undefined, '0']) {
  test(`Legacy empty JSON action reaches original DTO/guard/service; content-length=${length}`, async t => {
    const { app, calls, headers } = await fixture(t);
    if (length !== undefined) headers['content-length'] = length;
    const response = await app.inject({ method: 'POST', url: '/v1/meals/meal-fixture/recalculate?source=fixture', headers });
    assert.equal(response.statusCode, 201, response.body);
    assert.deepEqual(response.json(), { data: [{ key: 'fixture', status: 'UNKNOWN', required: null }] });
    assert.deepEqual(calls, [{ userId: 'user-fixture', householdId: 'household-fixture', mealId: 'meal-fixture', snapshotVersion: undefined }]);
  });
}

test('Compatibility retains authentication and domain authorization failures', async t => {
  const { app, calls, headers, jwt } = await fixture(t);
  for (const authorization of [undefined, 'Bearer invalid']) {
    const denied = { ...headers }; if (authorization) denied.authorization = authorization; else delete denied.authorization;
    const response = await app.inject({ method: 'POST', url: '/v1/meals/meal-fixture/recalculate', headers: denied });
    assert.equal(response.statusCode, 401, response.body);
  }
  assert.equal(calls.length, 0);
  for (const [extra, id, status] of [
    [{ 'x-household-id': 'another-household' }, 'meal-fixture', 403],
    [{ authorization: 'Bearer ' + await jwt.signAsync({ sub: 'no-inventory' }) }, 'meal-fixture', 403],
    [{}, 'missing-meal', 404],
  ]) assert.equal((await app.inject({ method: 'POST', url: `/v1/meals/${id}/recalculate`, headers: { ...headers, ...extra } })).statusCode, status);
});

test('Nonempty JSON and DTO validation preserve optional snapshot semantics', async t => {
  const { app, calls, headers } = await fixture(t);
  for (const [payload, version] of [['{}', undefined], ['{"snapshotVersion":2}', 2]]) {
    const response = await app.inject({ method: 'POST', url: '/v1/meals/meal-fixture/recalculate', headers, payload });
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(calls.at(-1).snapshotVersion, version);
  }
  for (const payload of ['{', ' ', '{"snapshotVersion":0}']) {
    const count = calls.length;
    const response = await app.inject({ method: 'POST', url: '/v1/meals/meal-fixture/recalculate', headers, payload });
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(calls.length, count);
  }
});

test('Other endpoints, methods, PATCH aliases and malformed MIME remain strict', async t => {
  const { app, calls, headers } = await fixture(t);
  for (const url of ['/v1/meals', '/v1/meals/meal-fixture/confirm', '/v1/meals/meal-fixture/recalculate/_patch']) {
    const response = await app.inject({ method: 'POST', url, headers });
    assert.ok([400, 404].includes(response.statusCode), response.body);
  }
  const get = await app.inject({ method: 'GET', url: '/v1/meals/meal-fixture/recalculate', headers });
  assert.equal(get.statusCode, 404);
  const invalidMime = await app.inject({ method: 'POST', url: '/v1/meals/meal-fixture/recalculate', headers: { ...headers, 'content-type': 'application/json-invalid' } });
  assert.equal(invalidMime.statusCode, 415);
  assert.equal(calls.length, 0);
});

test('JSON media type is case-insensitive and supports charset on the optional action', async t => {
  const { app, calls, headers } = await fixture(t);
  const response = await app.inject({ method: 'POST', url: '/v1/meals/meal-fixture/recalculate',
    headers: { ...headers, 'content-type': 'Application/JSON; charset=utf-8', 'content-length': '0' } });
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(calls.length, 1);
});

test('Transfer-encoded payloads retain the normal parser, including empty and valid JSON', async t => {
  const { app, calls, headers } = await fixture(t);
  const chunked = { ...headers, 'transfer-encoding': 'chunked' };
  const empty = await app.inject({ method: 'POST', url: '/v1/meals/meal-fixture/recalculate', headers: chunked });
  assert.equal(empty.statusCode, 400, empty.body);
  assert.equal(calls.length, 0);
  const valid = await app.inject({ method: 'POST', url: '/v1/meals/meal-fixture/recalculate', headers: chunked, payload: '{}' });
  assert.equal(valid.statusCode, 201, valid.body);
  assert.equal(calls.length, 1);
});
