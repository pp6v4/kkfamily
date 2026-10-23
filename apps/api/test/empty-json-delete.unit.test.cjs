const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('reflect-metadata');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { Test } = require('@nestjs/testing');
const { ValidationPipe, ForbiddenException, NotFoundException } = require('@nestjs/common');
const { FastifyAdapter } = require('@nestjs/platform-fastify');
const { JwtService } = require('@nestjs/jwt');
const { configureEmptyJsonCompatibility } = require('../src/common/empty-json-compatibility.ts');
const { MealsController } = require('../src/meals/meals.controller.ts');
const { MealsService } = require('../src/meals/meals.service.ts');
const { ItineraryController } = require('../src/trips/itinerary.controller.ts');
const { ItineraryService } = require('../src/trips/itinerary.service.ts');
const { PackingController } = require('../src/packing/packing.controller.ts');
const { PackingService } = require('../src/packing/packing.service.ts');
const { MembersController } = require('../src/members/members.controller.ts');
const { MembersService } = require('../src/members/members.service.ts');

const routes = [
  { operation: 'removeItem', url: '/v1/meals/meal-fixture/items/recipe-fixture', params: ['meal-fixture', 'recipe-fixture'], query: '', forwarded: [] },
  { operation: 'removeStop', url: '/v1/trips/trip-fixture/stops/stop-fixture', params: ['trip-fixture', 'stop-fixture'], query: '?expectedVersion=3&expectedTripVersion=7&confirm=true', forwarded: [3, 7, true] },
  { operation: 'removeLeg', url: '/v1/trips/trip-fixture/legs/leg-fixture', params: ['trip-fixture', 'leg-fixture'], query: '?expectedVersion=3&expectedTripVersion=7', forwarded: [3, 7] },
  { operation: 'removeAccommodation', url: '/v1/trips/trip-fixture/accommodations/accommodation-fixture', params: ['trip-fixture', 'accommodation-fixture'], query: '?expectedVersion=3&expectedTripVersion=7', forwarded: [3, 7] },
  { operation: 'removeTripItem', url: '/v1/trips/trip-fixture/packing-items/item-fixture', params: ['trip-fixture', 'item-fixture'], query: '?expectedVersion=3', forwarded: [3] },
];

async function fixture(t, { enabled = true, mealService } = {}) {
  const calls = [], jwt = new JwtService({ secret: 'fictional-delete-regression-only' });
  const operation = name => (...args) => {
    calls.push({ operation: name, args });
    if (args[1] !== 'household-fixture') throw new ForbiddenException('Household denied');
    if (args[2] === 'missing-fixture') throw new NotFoundException('Resource not found');
    return { data: { operation: name, removed: true } };
  };
  const module = await Test.createTestingModule({
    controllers: [MealsController, ItineraryController, PackingController, MembersController],
    providers: [
      { provide: MealsService, useValue: mealService ?? { removeItem: operation('removeItem'), transition: operation('transition') } },
      { provide: ItineraryService, useValue: Object.fromEntries(['removeStop', 'removeLeg', 'removeAccommodation'].map(name => [name, operation(name)])) },
      { provide: PackingService, useValue: { removeTripItem: operation('removeTripItem') } },
      { provide: MembersService, useValue: { revokeInvitation: operation('revokeInvitation') } },
      { provide: JwtService, useValue: jwt },
    ],
  }).compile();
  const app = module.createNestApplication(new FastifyAdapter(), { logger: false });
  if (enabled) configureEmptyJsonCompatibility(app);
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init(); await app.getHttpAdapter().getInstance().ready();
  t.after(() => app.close());
  const headers = { authorization: 'Bearer ' + await jwt.signAsync({ sub: 'user-fixture' }),
    'x-household-id': 'household-fixture', 'content-type': 'application/json' };
  return { app, calls, headers };
}

test('Released parser baseline rejects every bodyless DELETE before any guarded handler', async t => {
  const { app, calls, headers } = await fixture(t, { enabled: false });
  for (const route of routes) {
    const response = await app.inject({ method: 'DELETE', url: route.url + route.query, headers: { ...headers, 'content-length': '0' } });
    assert.equal(response.statusCode, 400, route.operation + ': ' + response.body);
    assert.match(response.json().message, /Body cannot be empty/);
  }
  assert.deepEqual(calls, []);
});

for (const route of routes) {
  for (const framing of ['no-length', 'zero-length', 'json-object']) {
    test(`${route.operation}: ${framing} reaches the original authenticated controller with exact query values`, async t => {
      const { app, calls, headers } = await fixture(t);
      if (framing === 'zero-length') headers['content-length'] = '0';
      const response = await app.inject({ method: 'DELETE', url: route.url + route.query, headers,
        ...(framing === 'json-object' ? { payload: '{}' } : {}) });
      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json(), { data: { operation: route.operation, removed: true } });
      assert.deepEqual(calls, [{ operation: route.operation,
        args: ['user-fixture', 'household-fixture', ...route.params, ...route.forwarded] }]);
    });
  }

  test(`${route.operation}: compatibility preserves JWT and service authorization/not-found failures`, async t => {
    const { app, calls, headers } = await fixture(t);
    for (const authorization of [undefined, 'Bearer invalid']) {
      const denied = { ...headers }; if (authorization) denied.authorization = authorization; else delete denied.authorization;
      const response = await app.inject({ method: 'DELETE', url: route.url + route.query, headers: denied });
      assert.equal(response.statusCode, 401, response.body);
    }
    assert.deepEqual(calls, []);
    const forbidden = await app.inject({ method: 'DELETE', url: route.url + route.query,
      headers: { ...headers, 'x-household-id': 'other-household' } });
    assert.equal(forbidden.statusCode, 403, forbidden.body);
    const missing = await app.inject({ method: 'DELETE', url: route.url.replace(route.params[0], 'missing-fixture') + route.query, headers });
    assert.equal(missing.statusCode, 404, missing.body);
    assert.equal(calls.length, 2);
  });

  test(`${route.operation}: malformed JSON, whitespace and chunked empty payloads stay strict`, async t => {
    const { app, calls, headers } = await fixture(t);
    for (const payload of ['{', ' ']) {
      const response = await app.inject({ method: 'DELETE', url: route.url + route.query, headers, payload });
      assert.equal(response.statusCode, 400, response.body);
    }
    const response = await app.inject({ method: 'DELETE', url: route.url + route.query,
      headers: { ...headers, 'transfer-encoding': 'chunked' } });
    assert.equal(response.statusCode, 400, response.body);
    assert.deepEqual(calls, []);
  });
}

test('Query DTOs still require valid positive versions on all four versioned DELETE actions', async t => {
  const { app, calls, headers } = await fixture(t);
  for (const route of routes.filter(item => item.query)) {
    const query = new URLSearchParams(route.query.slice(1));
    for (const invalid of ['', '?expectedVersion=-1', '?expectedVersion=1.5', '?expectedVersion=abc']) {
      const response = await app.inject({ method: 'DELETE', url: route.url + invalid, headers });
      assert.equal(response.statusCode, 400, route.operation + ': ' + response.body);
    }
    for (const invalid of ['0', '-1', '1.5', 'NaN']) {
      const invalidQuery = new URLSearchParams(query); invalidQuery.set('expectedVersion', invalid);
      const response = await app.inject({ method: 'DELETE', url: route.url + '?' + invalidQuery, headers });
      assert.equal(response.statusCode, 400, response.body);
    }
    if (query.has('expectedTripVersion')) {
      for (const invalid of ['0', '-1', '1.5', 'NaN']) {
        const invalidQuery = new URLSearchParams(query); invalidQuery.set('expectedTripVersion', invalid);
        const response = await app.inject({ method: 'DELETE', url: route.url + '?' + invalidQuery, headers });
        assert.equal(response.statusCode, 400, response.body);
      }
    }
  }
  assert.deepEqual(calls, []);
});

test('Stop confirmation false and omitted preserve the existing controller semantics', async t => {
  const { app, calls, headers } = await fixture(t);
  const stop = routes.find(route => route.operation === 'removeStop');
  for (const [confirmQuery, expected] of [['&confirm=false', false], ['', undefined]]) {
    const response = await app.inject({ method: 'DELETE', url: stop.url + '?expectedVersion=3&expectedTripVersion=7' + confirmQuery, headers });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(calls.at(-1).args.at(-1), expected);
  }
});

test('Required-body invitation DELETE, other routes, methods and malformed MIME are not made permissive', async t => {
  const { app, calls, headers } = await fixture(t);
  for (const payload of [undefined, '{}', '{"version":0}']) {
    const response = await app.inject({ method: 'DELETE', url: '/v1/invitations/invitation-fixture', headers,
      ...(payload === undefined ? {} : { payload }) });
    assert.equal(response.statusCode, 400, response.body);
  }
  assert.deepEqual(calls, []);
  const valid = await app.inject({ method: 'DELETE', url: '/v1/invitations/invitation-fixture', headers, payload: '{"version":4}' });
  assert.equal(valid.statusCode, 200, valid.body);
  assert.deepEqual(calls, [{ operation: 'revokeInvitation', args: ['user-fixture', 'household-fixture', 'invitation-fixture', 4] }]);
  for (const [method, url] of [
    ['DELETE', '/v1/meals/meal-fixture/items/recipe-fixture/_patch'],
    ['DELETE', '/v1/meals/meal-fixture/items'],
    ['POST', '/v1/meals/meal-fixture/items/recipe-fixture'],
    ['POST', '/v1/meals/meal-fixture/confirm'],
  ]) assert.ok([400, 404].includes((await app.inject({ method, url, headers })).statusCode), method + ' ' + url);
  const invalidMime = await app.inject({ method: 'DELETE', url: routes[0].url,
    headers: { ...headers, 'content-type': 'application/json-invalid' } });
  assert.equal(invalidMime.statusCode, 415, invalidMime.body);
  assert.equal(calls.length, 1);
});

test('Legacy DELETE with case-insensitive JSON MIME and charset still reaches the guarded handler', async t => {
  const { app, calls, headers } = await fixture(t);
  const response = await app.inject({ method: 'DELETE', url: routes[0].url,
    headers: { ...headers, 'content-type': 'Application/JSON; charset=utf-8', 'content-length': '0' } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(calls.length, 1);
});

function realMealServiceFixture() {
  const state = { meal: { id: 'meal-fixture', householdId: 'household-fixture', status: 'DRAFT', version: 4 },
    items: [
      { id: 'my-selection', mealId: 'meal-fixture', recipeId: 'recipe-fixture', addedById: 'member-own' },
      { id: 'spouse-selection', mealId: 'meal-fixture', recipeId: 'recipe-fixture', addedById: 'member-spouse' },
      { id: 'unrelated-selection', mealId: 'meal-fixture', recipeId: 'other-recipe', addedById: 'member-own' },
    ], dishes: [{ mealId: 'meal-fixture', recipeId: 'recipe-fixture' }, { mealId: 'meal-fixture', recipeId: 'other-recipe' }] };
  const matches = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
  const accessCalls = [], isolation = [];
  const tx = {
    meal: {
      findFirst: async ({ where }) => matches(state.meal, where) ? { ...state.meal, items: [...state.items] } : null,
      update: async ({ data }) => { state.meal.version += data.version.increment; return { ...state.meal }; },
    },
    mealItem: {
      deleteMany: async ({ where }) => { const before = state.items.length; state.items = state.items.filter(item => !matches(item, where)); return { count: before - state.items.length }; },
      count: async ({ where }) => state.items.filter(item => matches(item, where)).length,
    },
    mealDish: { deleteMany: async ({ where }) => { state.dishes = state.dishes.filter(item => !matches(item, where)); return { count: 1 }; } },
  };
  const prisma = { $transaction: async (fn, options) => { isolation.push(options.isolationLevel); return fn(tx); } };
  const access = { require: async (...args) => { assert.equal(args[4], tx); accessCalls.push(args.slice(0, 4)); return { id: 'member-own' }; } };
  return { service: new MealsService(prisma, access), state, accessCalls, isolation };
}

test('Actual legacy HTTP withdrawal executes MealsService, removes only the caller vote and is idempotent', async t => {
  const real = realMealServiceFixture(), { app, headers } = await fixture(t, { mealService: real.service });
  const response = await app.inject({ method: 'DELETE', url: routes[0].url, headers: { ...headers, 'content-length': '0' } });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { data: { removed: true } });
  assert.deepEqual(real.state.items.map(item => item.id), ['spouse-selection', 'unrelated-selection']);
  assert.deepEqual(real.state.dishes.map(item => item.recipeId), ['recipe-fixture', 'other-recipe']);
  assert.equal(real.state.meal.version, 5);
  const repeated = await app.inject({ method: 'DELETE', url: routes[0].url, headers });
  assert.equal(repeated.statusCode, 200, repeated.body);
  assert.deepEqual(repeated.json(), { data: { removed: false } });
  assert.equal(real.state.meal.version, 5);
  assert.deepEqual(real.state.items.map(item => item.id), ['spouse-selection', 'unrelated-selection']);
  assert.deepEqual(real.accessCalls, Array(2).fill(['user-fixture', 'household-fixture', 'meals', 'EDIT']));
  assert.deepEqual(real.isolation, ['Serializable', 'Serializable']);
});
