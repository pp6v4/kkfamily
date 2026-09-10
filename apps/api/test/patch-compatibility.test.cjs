const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('reflect-metadata');
const { Test } = require('@nestjs/testing');
const { ValidationPipe, ConflictException } = require('@nestjs/common');
const { FastifyAdapter } = require('@nestjs/platform-fastify');
const { JwtService } = require('@nestjs/jwt');
const { configurePatchCompatibility } = require('../dist/common/patch-compatibility');
const { RecipesService } = require('../dist/recipes/recipes.service');

function controllerFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? controllerFiles(path.join(dir, entry.name))
    : entry.name.endsWith('.controller.js') ? [path.join(dir, entry.name)] : []);
}

test('Every actual PATCH controller has a guarded POST alias using the identical Nest handler', async t => {
  const controllers = controllerFiles(path.resolve(__dirname, '../dist')).flatMap(file => Object.values(require(file)))
    .filter(value => typeof value === 'function' && Reflect.hasMetadata('path', value));
  const calls = [];
  const services = new Map();
  for (const controller of controllers) for (const service of Reflect.getMetadata('design:paramtypes', controller) || []) services.set(service, {});
  services.set(RecipesService, { updateStatus(userId, householdId, id, dto) {
    if (dto.expectedVersion !== 7) throw new ConflictException('stale version');
    const result = { userId, householdId, id, status: dto.status, version: 8 };
    calls.push(result); return { data: result };
  } });
  const jwt = new JwtService({ secret: 'fictional-patch-route-test-only' });
  const module = await Test.createTestingModule({ controllers, providers: [
    ...[...services].map(([provide, useValue]) => ({ provide, useValue })), { provide: JwtService, useValue: jwt },
  ] }).compile();
  const app = module.createNestApplication(new FastifyAdapter(), { logger: false });
  t.after(() => app.close());
  const routes = [];
  app.getHttpAdapter().getInstance().addHook('onRoute', route => routes.push(route));
  configurePatchCompatibility(app);
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init(); await app.getHttpAdapter().getInstance().ready();
  const originals = routes.filter(route => route.method === 'PATCH');
  assert.equal(originals.length, 24, 'Review coverage if the controller update surface changes');
  const aliases = routes.filter(route => route.method === 'POST' && route.url.endsWith('/_patch'));
  assert.equal(aliases.length, originals.length);
  for (const route of originals) {
    const alias = aliases.find(row => row.url === route.url + '/_patch');
    assert.ok(alias, route.url); assert.equal(alias.handler, route.handler);
    const url = alias.url.replace(/:[^/]+/g, 'fictional-id');
    const response = await app.inject({ method: 'POST', url, payload: {} });
    assert.equal(response.statusCode, 401, url + ': ' + response.body);
  }
  const headers = { authorization: 'Bearer ' + await jwt.signAsync({ sub: 'user-test' }), 'x-household-id': 'family-test' };
  for (const [method, url] of [['PATCH', '/v1/recipes/recipe-test/status'], ['POST', '/v1/recipes/recipe-test/status/_patch']]) {
    const success = await app.inject({ method, url, headers, payload: { status: 'PUBLISHED', expectedVersion: 7, ignored: true } });
    assert.equal(success.statusCode, 200, success.body);
    assert.deepEqual(success.json(), { data: { userId: 'user-test', householdId: 'family-test', id: 'recipe-test', status: 'PUBLISHED', version: 8 } });
    const invalid = await app.inject({ method, url, headers, payload: { status: 'BOGUS', expectedVersion: 0 } });
    assert.equal(invalid.statusCode, 400); assert.ok(invalid.json().message.some(value => value.includes('status')));
    const stale = await app.inject({ method, url, headers, payload: { status: 'PUBLISHED', expectedVersion: 6 } });
    assert.equal(stale.statusCode, 409);
    const denied = await app.inject({ method, url, headers: { authorization: 'Bearer invalid' }, payload: {} });
    assert.equal(denied.statusCode, 401);
  }
  assert.equal(calls.length, 2);
  for (const [method, url, extraHeaders] of [
    ['GET', '/v1/recipes/recipe-test/status/_patch', {}],
    ['POST', '/v1/recipes/recipe-test/status/_patch/_patch', {}],
    ['POST', '/v1/recipes/recipe-test/status', { 'x-http-method-override': 'PATCH' }],
    ['POST', '/v1/health/_patch', {}],
  ]) assert.equal((await app.inject({ method, url, headers: { ...headers, ...extraHeaders } })).statusCode, 404);
});

test('PATCH aliases retain nested prefixes, query, payload, hooks, schema and body limits', async t => {
  const adapter = new FastifyAdapter(); const server = adapter.getInstance();
  t.after(() => server.close());
  configurePatchCompatibility({ getHttpAdapter: () => adapter });
  server.register(async nested => {
    nested.route({ method: ['PATCH', 'PUT'], url: '/items/:id', bodyLimit: 100,
      schema: { body: { type: 'object', required: ['version'], properties: { version: { type: 'integer', minimum: 1 } } } },
      preHandler: async (req, reply) => { if (req.headers.authorization !== 'test') return reply.code(403).send({ denied: true }); },
      handler: async req => ({ id: req.params.id, version: req.body.version, cursor: req.query.cursor }),
    });
  }, { prefix: '/nested' });
  await server.ready();
  const url = '/nested/items/a/_patch?cursor=abc', headers = { authorization: 'test' };
  const ok = await server.inject({ method: 'POST', url, headers, payload: { version: 2 } });
  assert.equal(ok.statusCode, 200); assert.deepEqual(ok.json(), { id: 'a', version: 2, cursor: 'abc' });
  assert.equal((await server.inject({ method: 'POST', url, payload: { version: 2 } })).statusCode, 403);
  assert.equal((await server.inject({ method: 'POST', url, headers, payload: { version: -1 } })).statusCode, 400);
  assert.equal((await server.inject({ method: 'POST', url, headers, payload: { version: 2, large: 'x'.repeat(200) } })).statusCode, 413);
});
