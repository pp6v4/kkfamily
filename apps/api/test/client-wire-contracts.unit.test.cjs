const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
require('reflect-metadata');
const { Test } = require('@nestjs/testing');
const { RequestMethod, ValidationPipe } = require('@nestjs/common');
const { PATH_METADATA, METHOD_METADATA, ROUTE_ARGS_METADATA } = require('@nestjs/common/constants');
const { FastifyAdapter } = require('@nestjs/platform-fastify');
const { JwtService } = require('@nestjs/jwt');
const { configureEmptyJsonCompatibility } = require('../dist/common/empty-json-compatibility');
const { configurePatchCompatibility } = require('../dist/common/patch-compatibility');
const { configureImageBodyParser } = require('../dist/media/binary-parser');

// Representative valid protocol values, not production identities or data.
const id = 'resource-fixture', entity = { id, version: 3 };
const trip = { id: 'trip-fixture', version: 7 }, meal = { ...entity, snapshotVersion: 2 };
const from = '2026-10-01T00:00:00.000Z', to = '2026-11-01T00:00:00.000Z';
const recipe = { name: '番茄炒蛋', ingredients: [{ name: '番茄', quantity: 1, unit: '个', optional: false }], seasonings: ['盐'], steps: ['洗净后炒熟'] };
const familyCases = [
  ['listRecipeCategories', []], ['createRecipeCategory', ['主食', 2]],
  ['updateRecipeCategory', [entity, { name: '汤羹', sortOrder: 2 }]], ['archiveRecipeCategory', [entity]],
  ['listRecipes', []], ['getRecipe', [id]], ['createRecipe', [recipe]],
  ['updateRecipe', [id, { ...recipe, expectedVersion: 3, categoryId: null }]], ['updateRecipeStatus', [entity, 'PUBLISHED']],
  ['createMediaUploadIntent', [{ ownerType: 'RECIPE', ownerId: id, expectedOwnerVersion: 3, mimeType: 'image/png', byteSize: 4 }]],
  ['uploadMediaContent', ['/media/upload-intents/intent-fixture/content', new Uint8Array([0, 127, 255, 10]).buffer, 'image/png']],
  ['confirmMediaAsset', [id, 'a'.repeat(64)]], ['getMediaReadUrl', [id]], ['listTripPhotos', [trip.id]],
  ['listMeals', [from, to]], ['createMeal', [{ scheduledAt: from, mealType: 'DINNER', slotKey: 'DINNER' }]],
  ['addMealRecipe', [id, 'recipe-fixture']], ['removeMealRecipe', [id, 'recipe-fixture']], ['recalculateMeal', [id]],
  ['completeMeal', [meal]], ...['confirm', 'reopen', 'start', 'cancel'].map(action => ['transitionMeal', [meal, action, action === 'reopen' ? '重新安排' : undefined]]),
  ['updateMealDish', [meal, 'recipe-fixture', 1.5]], ['removeMealDish', [meal, 'recipe-fixture']], ['listMealSnapshots', [id]],
  ['listShoppingLists', []], ['addShoppingItem', [{ name: '牛奶', quantity: 2, unit: '盒', status: 'NEXT_TRIP' }]],
  ['updateShoppingItem', [entity, 'PURCHASED']], ['repeatShoppingItem', [id, 'repeat-request-fixture']],
  ['importMealShortages', [meal, ['FOOD:tomato:个']]], ['listInventory', []],
  ['setInventoryItem', [{ name: '番茄', kind: 'FOOD', availability: 'PRESENT', quantity: 2, unit: '个' }]],
  ['listCalendarEvents', [from, to]], ['createCalendarEvent', [{ type: 'ANNIVERSARY', title: '纪念日', startsAt: from }]],
  ['listAnniversaries', []], ['createAnniversary', [{ title: '纪念日', localDate: '2026-10-01', recurrence: 'YEARLY', leapPolicy: 'FEB_28' }]],
  ['updateAnniversary', [entity, { title: '新的纪念日', note: null }]], ['archiveAnniversary', [entity]], ['archiveLegacyAnniversary', [entity]],
  ['listTrips', []], ['createTrip', [{ title: '去露营', startsAt: from, destination: '北京', initialDestination: { title: '营地', latitude: 40, longitude: 116 } }]],
  ['getTrip', [trip.id]], ['updateTrip', [trip, { title: '新的行程', endsAt: null }]], ['updateTripStatus', [trip, 'PENDING']],
  ['listTripCandidates', [trip.id]], ['addTripMember', [trip.id, 'member-fixture', true]],
  ['updateTripMember', [trip.id, { membershipId: 'member-fixture', version: 3 }, { canEdit: false, photoAdd: true }]],
  ['createTripPreparationGroup', [trip.id, '准备一组', ['member-fixture']]],
  ['updateTripPreparationGroup', [trip.id, entity, '准备二组', ['member-fixture']]], ['getTripItinerary', [trip.id]],
  ['createTripStop', [trip, { title: '营地', stopType: 'CAMPSITE', latitude: 40, longitude: 116 }]],
  ['updateTripStop', [trip, entity, { title: '营地二', arriveAt: null }]], ['reorderTripStops', [trip, [id, 'stop-other']]],
  ['getTripStopDeleteImpact', [trip.id, id]], ['removeTripStop', [trip, entity, true]],
  ['createTripLeg', [trip, { fromStopId: id, toStopId: 'stop-other', mode: 'DRIVING', routeKind: 'SCHEMATIC' }]],
  ['updateTripLeg', [trip, entity, { mode: 'RAIL', distanceMeters: 100 }]], ['removeTripLeg', [trip, entity]],
  ['createAccommodation', [trip, { name: '营地酒店', checkInDate: '2026-10-01', checkOutDate: '2026-10-02' }]],
  ['updateAccommodation', [trip, entity, { name: '新的酒店', stopId: null }]], ['removeAccommodation', [trip, entity]],
  ['listPackingTemplates', []], ['createPackingTemplate', [{ name: '自定义模板', items: [{ name: '水杯', quantity: 1, unit: '个' }] }]],
  ['updatePackingTemplate', [entity, { name: '新模板', description: null }]], ['listTripPackingItems', [trip.id]],
  ['applyPackingTemplate', [trip.id, id]], ['createTripPackingItem', [trip.id, { name: '水杯', quantity: 1, unit: '个' }]],
  ['updateTripPackingItem', [trip.id, entity, { status: 'PACKED', responsibleMembershipId: '' }]], ['removeTripPackingItem', [trip.id, entity]],
  ['listTasks', ['PENDING']], ['getTask', [id]], ['listTaskAssignees', []],
  ['createTask', [{ type: 'TODO', title: '清洗空调', priority: 'NORMAL', dueAt: to }]],
  ['updateTask', [entity, { title: '清洗空调二', dueAt: null, reminderAt: null }]],
  ['updateTaskStatus', [entity, 'COMPLETED']], ['addTaskComment', [id, '完成了']],
  ['listFavorites', []], ['getFavorite', [id]], ['createFavorite', [{ type: 'TEXT', title: '晚餐灵感', text: '番茄炒蛋', tags: ['晚餐'], visibility: 'HOUSEHOLD' }]],
  ['updateFavorite', [entity, { title: '新的灵感', text: null, sourceUrl: null }]], ['archiveFavorite', [entity]],
  ['convertFavorite', [entity, { targetType: 'RECIPE', idempotencyKey: 'conversion-fixture', confirmedTitle: '番茄炒蛋' }]],
  ['listArchiveFields', []], ['createArchiveField', [{ key: 'contact_info', label: '联系方式', valueType: 'CONTACT', sensitive: false, visibility: 'MEMBERS', grants: [] }]],
  ['updateArchiveField', [entity, { label: '新的联系方式', grants: [] }]], ['archiveArchiveField', [entity]],
  ['getArchiveValue', [id]], ['setArchiveValue', [id, '', 0]], ['getDashboardSummary', [from, to]],
  ['listInbox', []], ['readInboxItem', [entity]], ['listNotificationPreferences', []],
  ['updateNotificationPreference', [{ version: 0, eventType: 'TASK_REMINDER' }, { enabled: true, leadMinutes: 0, quietStart: null, quietEnd: null }]],
  ['getPublicNotificationSettings', []], ['recordSubscriptionReceipt', [{ templateId: 'template-fixture', result: 'REJECT', clientScene: 'local-test' }]],
];
const memberCases = [
  ['listMembers', ['cursor fixture']], ['roleCatalog', []], ['listInvitations', []], ['createInvitation', [['MEMBER'], []]],
  ['revokeInvitation', [entity]], ['saveMemberPermissions', [entity, ['MEMBER'], []]],
  ['setMemberStatus', [entity, 'DISABLED']], ['transferAdmin', [entity, 5]],
];
const directCases = [
  ['/auth/wechat/login', 'POST', { code: 'code-fixture' }], ['/auth/refresh', 'POST', { refreshToken: 'r'.repeat(40) }],
  ['/auth/logout', 'POST', { refreshToken: 'r'.repeat(40) }], ['/auth/me', 'GET'], ['/auth/me', 'PATCH', { nickname: '扣扣' }],
  ['/households/current/access', 'GET'], ['/households', 'POST', { name: '扣扣的家' }],
  ['/invitations/redeem', 'POST', { code: 'r'.repeat(32) }],
];

function controllerFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? controllerFiles(path.join(dir, entry.name)) : entry.name.endsWith('.controller.js') ? [path.join(dir, entry.name)] : []);
}
const controllers = controllerFiles(path.resolve(__dirname, '../dist')).flatMap(file => Object.values(require(file)))
  .filter(value => typeof value === 'function' && Reflect.hasMetadata(PATH_METADATA, value));
const routes = controllers.flatMap(controller => Object.getOwnPropertyNames(controller.prototype).flatMap(name => {
  const handler = controller.prototype[name], method = typeof handler === 'function' && Reflect.getMetadata(METHOD_METADATA, handler);
  if (typeof method !== 'number') return [];
  const url = '/' + ['v1', Reflect.getMetadata(PATH_METADATA, controller), Reflect.getMetadata(PATH_METADATA, handler)]
    .filter(Boolean).flatMap(part => part.split('/')).filter(Boolean).join('/');
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, name) || {};
  return [{ method: RequestMethod[method], url, body: Object.keys(args).some(key => key.startsWith('3:')) }];
}));
let app, calls, sent, traces, transport, api, members, jwtHeaders;
const visited = new Set();
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
before(async () => {
  calls = []; sent = []; traces = [];
  const services = new Map();
  for (const controller of controllers) for (const service of Reflect.getMetadata('design:paramtypes', controller) || []) {
    services.set(service, Object.fromEntries(Object.getOwnPropertyNames(service.prototype)
      .filter(name => name !== 'constructor' && typeof service.prototype[name] === 'function')
      .map(operation => [operation, (...args) => { const call = { service: service.name, operation, args }; calls.push(call); return { data: call }; }])));
  }
  const jwt = new JwtService({ secret: 'fictional-valid-client-contract-tests-only' });
  const module = await Test.createTestingModule({ controllers, providers: [
    ...[...services].map(([provide, useValue]) => ({ provide, useValue })), { provide: JwtService, useValue: jwt },
  ] }).compile();
  app = module.createNestApplication(new FastifyAdapter(), { logger: false });
  app.getHttpAdapter().getInstance().addHook('onRequest', async request => traces.push({ method: request.method, url: request.routeOptions.url }));
  configureImageBodyParser(app); configureEmptyJsonCompatibility(app); configurePatchCompatibility(app);
  app.setGlobalPrefix('v1'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init(); await app.getHttpAdapter().getInstance().ready();
  const accessToken = await jwt.signAsync({ sub: 'user-fixture' });
  jwtHeaders = { Authorization: `Bearer ${accessToken}`, 'X-Household-Id': 'household-fixture' };
  const uni = { request(options) {
    sent.push(options);
    const destination = new URL(options.url);
    assert.equal(destination.origin, 'https://example.test');
    const body = options.data;
    const payload = body === undefined ? undefined : body instanceof ArrayBuffer ? Buffer.from(body) : typeof body === 'string' ? body : JSON.stringify(body);
    app.inject({ method: options.method, url: destination.pathname.replace(/^\/api/, '') + destination.search,
      headers: options.header, ...(payload === undefined ? {} : { payload }) })
      .then(response => options.success({ statusCode: response.statusCode, data: response.json() }), error => options.fail({ errMsg: error.message }));
  } };
  transport = clientModule('transport.ts', { './config': { API_BASE_URL: 'https://example.test/api/v1' } }, uni);
  const session = { getSessionEpoch: () => 0, assertSessionEpoch() {}, ensureSession: async () => ({ accessToken, householdId: 'household-fixture' }) };
  api = clientModule('family-api.ts', { './session': session, './transport': transport, './config': { API_BASE_URL: 'https://example.test/api/v1' } });
  members = clientModule('members-api.ts', { './session': session, './transport': transport });
});
after(async () => { if (app) await app.close(); });

function assertReached(previousCalls, previousSent, previousTraces, result) {
  assert.equal(calls.length, previousCalls + 1, 'Exactly one real controller-to-service invocation');
  assert.equal(sent.length, previousSent + 1, 'Exactly one transport request, without hidden retry');
  assert.equal(traces.length, previousTraces + 1, 'Exactly one registered route');
  const trace = traces.at(-1);
  assert.ok(trace.url, 'A parser-generated 400 for an unknown route is not contract success');
  visited.add(`${trace.method} ${trace.url}`);
  const json = JSON.parse(JSON.stringify(calls.at(-1)));
  assert.deepEqual(result, json, 'The JSON envelope is unpacked into the exact forwarded service result');
  assert.match(sent.at(-1).header.Authorization, /^Bearer /);
  const declared = routes.find(route => route.method === trace.method && route.url === trace.url
    || route.method === 'PATCH' && trace.method === 'POST' && route.url + '/_patch' === trace.url);
  assert.ok(declared, `Registered client target has a real controller: ${trace.method} ${trace.url}`);
  const parameters = Object.fromEntries(new URL(sent.at(-1).url).searchParams);
  if (trace.method === 'GET' && Object.keys(parameters).length) {
    assert.deepEqual(json.args.at(-1), declared.url === '/v1/members' ? parameters.cursor : parameters,
      'Query strings preserve date bounds, task filters and decoded member cursors');
  }
  if (trace.method === 'DELETE' && parameters.expectedVersion) {
    const expected = [Number(parameters.expectedVersion)];
    if (parameters.expectedTripVersion) expected.push(Number(parameters.expectedTripVersion));
    if (parameters.confirm !== undefined) expected.push(parameters.confirm === 'true');
    assert.deepEqual(json.args.slice(-expected.length), expected, 'DELETE version and confirmation scalars are correctly typed and ordered');
  }
  if (declared.body && sent.at(-1).header['content-type'] === 'application/json') {
    const body = JSON.parse(JSON.stringify(sent.at(-1).data));
    const scalar = {
      '/v1/auth/wechat/login': 'code', '/v1/auth/refresh': 'refreshToken', '/v1/auth/logout': 'refreshToken',
      '/v1/auth/me': 'nickname', '/v1/meals/:id/recalculate': 'snapshotVersion', '/v1/invitations/:id': 'version',
      '/v1/households': 'name', '/v1/invitations/redeem': 'code',
    }[declared.url];
    assert.deepEqual(json.args.at(-1), scalar ? body[scalar] ?? null : body,
      'All sent JSON fields/versions survive DTO validation and reach the actual controller service arguments');
  }
  if (declared.url === '/v1/media/upload-intents/:id/content') {
    assert.equal(trace.method, 'PUT');
    assert.equal(sent.at(-1).header['content-type'], 'image/png');
    assert.deepEqual(json.args.slice(-2), ['image/png', { type: 'Buffer', data: [0, 127, 255, 10] }], 'Binary content never passes through JSON conversion');
  }
  if (!trace.url.startsWith('/v1/auth/') && trace.url !== '/v1/households' && trace.url !== '/v1/invitations/redeem') {
    assert.deepEqual(json.args.slice(0, 2), ['user-fixture', 'household-fixture']);
  }
}
for (const [name, args] of familyCases) test(`Valid family API contract: ${name}${name === 'transitionMeal' ? ' ' + args[1] : ''}`, async () => {
  const before = [calls.length, sent.length, traces.length];
  assertReached(...before, await api[name](...args));
});
for (const [name, args] of memberCases) test(`Valid member API contract: ${name}`, async () => {
  const before = [calls.length, sent.length, traces.length];
  assertReached(...before, await members[name](...args));
});
for (const [url, method, body] of directCases) test(`Valid identity/join literal contract: ${method} ${url}`, async () => {
  const before = [calls.length, sent.length, traces.length];
  assertReached(...before, await transport.rawRequest(url, method, body, jwtHeaders));
});
test('All exported business HTTP functions and every write route have a valid real-wire fixture', () => {
  assert.deepEqual(Object.keys(api).filter(key => typeof api[key] === 'function' && !['publicMediaUrl', 'mealTypeLabel'].includes(key)).sort(),
    [...new Set(familyCases.map(([name]) => name))].sort());
  assert.deepEqual(Object.keys(members).filter(key => typeof members[key] === 'function').sort(), memberCases.map(([name]) => name).sort());
  assert.equal(visited.size, 113, 'Client HTTP method/path surface (including four meal transitions and binary upload)');
  for (const route of routes.filter(route => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.method))) {
    const wire = route.method === 'PATCH' ? `POST ${route.url}/_patch` : `${route.method} ${route.url}`;
    assert.ok(visited.has(wire), 'Valid fixture missing for ' + wire);
  }
});
