const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
require('reflect-metadata');
const { Test } = require('@nestjs/testing');
const { RequestMethod, ValidationPipe } = require('@nestjs/common');
const { PATH_METADATA, METHOD_METADATA, ROUTE_ARGS_METADATA, GUARDS_METADATA } = require('@nestjs/common/constants');
const { FastifyAdapter } = require('@nestjs/platform-fastify');
const { JwtService } = require('@nestjs/jwt');
const { configureEmptyJsonCompatibility } = require('../dist/common/empty-json-compatibility');
const { configurePatchCompatibility } = require('../dist/common/patch-compatibility');
const { configureImageBodyParser } = require('../dist/media/binary-parser');

// Discover real controllers/DTOs instead of maintaining a second route allowlist.
function controllerFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? controllerFiles(path.join(directory, entry.name))
    : entry.name.endsWith('.controller.js') ? [path.join(directory, entry.name)] : []);
}
const controllers = controllerFiles(path.resolve(__dirname, '../dist')).flatMap(file => Object.values(require(file)))
  .filter(value => typeof value === 'function' && Reflect.hasMetadata(PATH_METADATA, value));
const routes = controllers.flatMap(controller => Object.getOwnPropertyNames(controller.prototype).flatMap(name => {
  const handler = controller.prototype[name];
  const method = typeof handler === 'function' && Reflect.getMetadata(METHOD_METADATA, handler);
  if (typeof method !== 'number') return [];
  const url = '/' + ['v1', Reflect.getMetadata(PATH_METADATA, controller), Reflect.getMetadata(PATH_METADATA, handler)]
    .filter(Boolean).flatMap(part => part.split('/')).filter(Boolean).join('/');
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, name) || {};
  const body = Object.entries(args).find(([key]) => key.startsWith('3:'))?.[1];
  const metatype = body && Reflect.getMetadata('design:paramtypes', controller.prototype, name)[body.index];
  const guarded = [...(Reflect.getMetadata(GUARDS_METADATA, controller) || []), ...(Reflect.getMetadata(GUARDS_METADATA, handler) || [])].length > 0;
  return [{ method: RequestMethod[method], url, body, metatype, guarded }];
}));
const writes = routes.filter(route => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.method));
const pipe = new ValidationPipe({ whitelist: true, transform: true });
let app, headers, calls, registered, optional, required, binary;

before(async () => {
  calls = []; registered = [];
  const services = new Map();
  for (const controller of controllers) {
    for (const service of Reflect.getMetadata('design:paramtypes', controller) || []) {
      services.set(service, Object.fromEntries(Object.getOwnPropertyNames(service.prototype)
        .filter(name => name !== 'constructor' && typeof service.prototype[name] === 'function')
        .map(name => [name, (...args) => {
          const result = { service: service.name, operation: name, args };
          calls.push(result); return { data: result };
        }])));
    }
  }
  const jwt = new JwtService({ secret: 'fictional-boundary-contract-tests-only' });
  const module = await Test.createTestingModule({ controllers, providers: [
    ...[...services].map(([provide, useValue]) => ({ provide, useValue })),
    { provide: JwtService, useValue: jwt },
  ] }).compile();
  app = module.createNestApplication(new FastifyAdapter(), { logger: false });
  app.getHttpAdapter().getInstance().addHook('onRoute', route => registered.push(route));
  configureImageBodyParser(app);
  configureEmptyJsonCompatibility(app);
  configurePatchCompatibility(app);
  app.setGlobalPrefix('v1'); app.useGlobalPipes(pipe);
  await app.init(); await app.getHttpAdapter().getInstance().ready();
  headers = { authorization: 'Bearer ' + await jwt.signAsync({ sub: 'user-fixture' }),
    'x-household-id': 'household-fixture', 'content-type': 'application/json' };
  optional = []; required = []; binary = [];
  for (const route of writes) {
    if (!route.body) optional.push(route);
    else if (!route.metatype || route.metatype === Object) binary.push(route);
    else {
      try {
        await pipe.transform({}, { type: 'body', metatype: route.metatype });
        optional.push(route);
      } catch (error) {
        assert.equal(error.getStatus?.(), 400, route.url);
        required.push(route);
      }
    }
  }
});
after(async () => { if (app) await app.close(); });

function urlFor(route) {
  return route.url.replace(/:[^/]+/g, 'resource-fixture') + '?expectedVersion=3&expectedTripVersion=7&confirm=true';
}
function noCallsSince(length, message) { assert.equal(calls.length, length, message); }

test('The discovered HTTP surface has no unclassified writes or missing PATCH aliases', t => {
  // Changes require an explicit coverage review, not silently skipping a new endpoint.
  assert.equal(controllers.length, 19);
  assert.equal(routes.length, 118);
  assert.equal(writes.length, 79);
  assert.equal(optional.length, 6);
  assert.equal(required.length, 72);
  assert.equal(binary.length, 1);
  assert.deepEqual(binary.map(route => route.url), ['/v1/media/upload-intents/:id/content']);
  for (const route of routes) assert.ok(registered.some(value => value.method === route.method && value.url === route.url), route.method + ' ' + route.url);
  const patches = routes.filter(route => route.method === 'PATCH');
  assert.equal(patches.length, 24);
  for (const route of patches) {
    const original = registered.find(value => value.method === 'PATCH' && value.url === route.url);
    const alias = registered.find(value => value.method === 'POST' && value.url === route.url + '/_patch');
    assert.ok(original, route.url); assert.ok(alias, route.url);
    assert.equal(original.handler, alias.handler, route.url);
  }
  t.diagnostic('19 controllers; 118 routes; 79 writes = 6 body-optional + 72 required DTO + 1 binary; 24 PATCH aliases');
});

test('Every discovered body-optional write accepts released empty JSON framing and explicit objects', async () => {
  for (const route of optional) {
    for (const framing of ['omitted-length', 'zero-length', 'object']) {
      const previous = calls.length;
      const response = await app.inject({ method: route.method, url: urlFor(route),
        headers: { ...headers, ...(framing === 'zero-length' ? { 'content-length': '0' } : {}) },
        ...(framing === 'object' ? { payload: '{}' } : {}) });
      assert.ok(response.statusCode >= 200 && response.statusCode < 300, `${route.method} ${route.url} ${framing}: ${response.body}`);
      assert.equal(calls.length, previous + 1, route.url);
      assert.deepEqual(calls.at(-1).args.slice(0, 2), ['user-fixture', 'household-fixture']);
    }
  }
});

test('Every required-body write rejects empty JSON and empty objects before a service write, including PATCH aliases', async () => {
  for (const route of required) {
    const variants = [{ method: route.method, url: urlFor(route) }];
    if (route.method === 'PATCH') variants.push({ method: 'POST', url: urlFor({ ...route, url: route.url + '/_patch' }) });
    for (const variant of variants) {
      for (const payload of [undefined, '{}']) {
        const previous = calls.length;
        const response = await app.inject({ ...variant, headers, ...(payload === undefined ? {} : { payload }) });
        assert.equal(response.statusCode, 400, `${variant.method} ${variant.url}: ${response.body}`);
        if (payload === '{}') assert.ok(Array.isArray(response.json().message), 'Expected actual DTO field errors, not controller/router rejection: ' + response.body);
        noCallsSince(previous, route.url);
      }
    }
  }
});

test('Malformed/whitespace JSON is rejected on all 79 writes and all 24 PATCH aliases without service effects', async () => {
  for (const route of writes) {
    const variants = [{ method: route.method, url: urlFor(route) }];
    if (route.method === 'PATCH') variants.push({ method: 'POST', url: urlFor({ ...route, url: route.url + '/_patch' }) });
    for (const variant of variants) for (const payload of ['{', ' ']) {
      const previous = calls.length;
      const response = await app.inject({ ...variant, headers, payload });
      assert.equal(response.statusCode, 400, `${variant.method} ${variant.url}: ${response.body}`);
      noCallsSince(previous, route.url);
    }
  }
});

test('Released body-optional writes retain authentication for omitted and invalid JWTs', async () => {
  for (const route of optional) for (const authorization of [undefined, 'Bearer invalid']) {
    const denied = { ...headers }; if (authorization) denied.authorization = authorization; else delete denied.authorization;
    const previous = calls.length;
    const response = await app.inject({ method: route.method, url: urlFor(route), headers: denied });
    assert.equal(response.statusCode, 401, route.url + ': ' + response.body);
    noCallsSince(previous, route.url);
  }
});

test('All guarded native routes and PATCH aliases reject unauthenticated well-framed requests before services', async t => {
  const guarded = routes.filter(route => route.guarded);
  assert.equal(guarded.length, 113, 'Public endpoint changes require explicit authentication review');
  for (const route of guarded) {
    const variants = [{ method: route.method, url: urlFor(route) }];
    if (route.method === 'PATCH') variants.push({ method: 'POST', url: urlFor({ ...route, url: route.url + '/_patch' }) });
    for (const variant of variants) {
      const previous = calls.length;
      const response = await app.inject({ ...variant, headers: { 'content-type': 'application/json' },
        ...(route.method === 'GET' ? {} : { payload: '{}' }) });
      assert.equal(response.statusCode, 401, variant.method + ' ' + variant.url + ': ' + response.body);
      noCallsSince(previous, route.url);
    }
  }
  t.diagnostic('113 guarded native routes plus 24 PATCH aliases; five existing public routes are separately excluded');
});

function clientModule(filename, dependencies, uni = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../../client/src/services', filename), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, uni, require(name) {
    assert.ok(name in dependencies, 'Unexpected client import ' + name); return dependencies[name];
  } });
  return module.exports;
}

test('Actual client wrapper -> JSON serialization -> real Nest route preserves all six optional actions', async () => {
  const sent = [];
  const transport = clientModule('transport.ts', { './config': { API_BASE_URL: 'https://example.test/api/v1' } }, {
    request(options) {
      sent.push(options);
      const payload = options.data === undefined ? undefined : typeof options.data === 'string' ? options.data : JSON.stringify(options.data);
      app.inject({ method: options.method, url: new URL(options.url).pathname.replace(/^\/api/, '') + new URL(options.url).search,
        headers: options.header, ...(payload === undefined ? {} : { payload }) })
        .then(response => options.success({ statusCode: response.statusCode, data: response.json() }), error => options.fail({ errMsg: error.message }));
    },
  });
  const session = { getSessionEpoch: () => 0, assertSessionEpoch() {}, ensureSession: async () => ({ accessToken: headers.authorization.slice(7), householdId: 'household-fixture' }) };
  const api = clientModule('family-api.ts', { './session': session, './transport': transport, './config': { API_BASE_URL: 'https://example.test/api/v1' } });
  const trip = { id: 'trip-fixture', version: 7 }, entity = { id: 'item-fixture', version: 3 };
  const cases = [
    [() => api.recalculateMeal('meal-fixture'), 'recalculate', ['meal-fixture', null]],
    [() => api.removeMealRecipe('meal-fixture', 'recipe-fixture'), 'removeItem', ['meal-fixture', 'recipe-fixture']],
    [() => api.removeTripStop(trip, entity, true), 'removeStop', ['trip-fixture', 'item-fixture', 3, 7, true]],
    [() => api.removeTripLeg(trip, entity), 'removeLeg', ['trip-fixture', 'item-fixture', 3, 7]],
    [() => api.removeAccommodation(trip, entity), 'removeAccommodation', ['trip-fixture', 'item-fixture', 3, 7]],
    [() => api.removeTripPackingItem(trip.id, entity), 'removeTripItem', ['trip-fixture', 'item-fixture', 3]],
  ];
  for (const [invoke, operation, args] of cases) {
    const result = await invoke();
    assert.equal(result.operation, operation);
    assert.deepEqual(result.args, ['user-fixture', 'household-fixture', ...args]);
    assert.equal(JSON.stringify(sent.at(-1).data), '{}');
  }
  assert.equal(sent.length, optional.length, 'Every discovered body-optional action needs a real wrapper fixture');
});

test('Actual binary transport and parser preserve upload bytes, MIME and identity separately from JSON compatibility', async () => {
  const bytes = new Uint8Array([0, 127, 255, 10]).buffer;
  const transport = clientModule('transport.ts', { './config': { API_BASE_URL: 'https://example.test/api/v1' } }, {
    request(options) {
      assert.equal(options.method, 'PUT');
      assert.equal(options.url, 'https://example.test/api/v1/media/upload-intents/intent-fixture/content');
      assert.equal(options.header['content-type'], 'image/png');
      const url = new URL(options.url);
      app.inject({ method: options.method, url: url.pathname.replace(/^\/api/, '') + url.search, headers: options.header,
        payload: Buffer.from(options.data) }).then(response => options.success({ statusCode: response.statusCode, data: response.json() }),
        error => options.fail({ errMsg: error.message }));
    },
  });
  const result = await transport.rawBinaryRequest('/media/upload-intents/intent-fixture/content', 'PUT', bytes, 'image/png', {
    Authorization: headers.authorization, 'X-Household-Id': 'household-fixture',
  });
  assert.equal(result.operation, 'upload');
  assert.deepEqual(result.args.slice(0, 4), ['user-fixture', 'household-fixture', 'intent-fixture', 'image/png']);
  assert.deepEqual(result.args[4], { type: 'Buffer', data: [0, 127, 255, 10] });
});
