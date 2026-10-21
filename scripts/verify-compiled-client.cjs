#!/usr/bin/env node
'use strict';

/**
 * Read-only smoke checks for the actual WeChat JS/WXML build.
 *
 * Uses the client's existing Vue dependency. Vue reactivity is real, while the
 * uni-app vendor render helpers, native callbacks and backend are simulated.
 * No requests, login, credentials, image files or production writes are used.
 * This does NOT verify WeChat event dispatch, focus, keyboard, layout or devices.
 *
 * node scripts/verify-compiled-client.cjs
 * node scripts/verify-compiled-client.cjs --dir ../outputs/mp-weixin
 * node scripts/verify-compiled-client.cjs --api-contracts
 *
 * --api-contracts additionally validates the emitted payloads using the current
 * API source DTOs and the real Nest ValidationPipe. It needs the API's existing
 * dependencies; missing dependencies fail rather than silently skip validation.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const repository = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
let vue, parseSfc;

function argumentsFor(argv) {
  let directory = path.join(repository, 'apps/client/dist/build/mp-weixin');
  let apiContracts = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--help') return { help: true };
    if (argument === '--api-contracts') {
      apiContracts = true;
    } else if (argument === '--dir') {
      assert.ok(argv[index + 1] && !argv[index + 1].startsWith('--'), '--dir requires a directory');
      directory = path.resolve(argv[++index]);
    } else if (argument.startsWith('--dir=')) {
      assert.ok(argument.slice(6), '--dir requires a directory');
      directory = path.resolve(argument.slice(6));
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return { directory, apiContracts };
}

function requiredFile(directory, relative) {
  const filename = path.join(directory, relative);
  assert.ok(fs.existsSync(filename) && fs.statSync(filename).isFile(), `Missing compiled artifact: ${filename}`);
  return fs.readFileSync(filename, 'utf8');
}

function createApiContracts() {
  const apiRoot = path.join(repository, 'apps/api');
  const apiRequire = createRequire(path.join(apiRoot, 'package.json'));
  apiRequire('reflect-metadata');
  const typescript = apiRequire('typescript');
  const { ValidationPipe } = apiRequire('@nestjs/common');
  const validator = apiRequire('class-validator');
  const transformer = apiRequire('class-transformer');
  const sources = {
    createRecipe: ['src/recipes/dto/create-recipe.dto.ts', 'CreateRecipeDto'],
    createPackingTemplate: ['src/packing/dto/create-packing-template.dto.ts', 'CreatePackingTemplateDto'],
    createTrip: ['src/trips/dto/create-trip.dto.ts', 'CreateTripDto'],
  };
  const allowed = new Set(['src/common/trim-text.ts', ...Object.values(sources).map(([relative]) => relative)].map(relative => path.join(apiRoot, relative)));
  const external = new Map([['class-validator', validator], ['class-transformer', transformer]]);
  const cache = new Map();
  function load(filename) {
    assert.ok(allowed.has(filename), `API source loader denied: ${filename}`);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const source = fs.readFileSync(filename, 'utf8');
    const compiled = typescript.transpileModule(source, {
      fileName: filename,
      reportDiagnostics: true,
      compilerOptions: {
        target: typescript.ScriptTarget.ES2022,
        module: typescript.ModuleKind.CommonJS,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        useDefineForClassFields: false,
      },
    });
    const errors = (compiled.diagnostics || []).filter(item => item.category === typescript.DiagnosticCategory.Error);
    assert.equal(errors.length, 0, `Invalid API DTO source: ${errors.map(item => typescript.flattenDiagnosticMessageText(item.messageText, '\n')).join('; ')}`);
    const dtoRequire = id => {
      if (external.has(id)) return external.get(id);
      assert.ok(id.startsWith('.'), `API source loader denied import: ${id}`);
      const dependency = path.resolve(path.dirname(filename), id);
      return load(dependency.endsWith('.ts') ? dependency : `${dependency}.ts`);
    };
    // Execute these explicitly allowlisted repository DTO modules in Node's
    // normal realm, just like the application. A separate VM realm changes
    // instanceof/metadata semantics; never alter DTO prototypes to hide that.
    const execute = vm.compileFunction(compiled.outputText, ['exports', 'require', 'module', '__filename', '__dirname'], { filename });
    execute(module.exports, dtoRequire, module, filename, path.dirname(filename));
    return module.exports;
  }
  const contracts = new Map(Object.entries(sources).map(([operation, [relative, exported]]) => {
    const dto = load(path.join(apiRoot, relative))[exported];
    assert.equal(typeof dto, 'function', `Missing source DTO export: ${exported}`);
    return [operation, dto];
  }));
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, validatorPackage: validator, transformerPackage: transformer });
  const checked = new Set();
  const badRequest = error => error?.getStatus?.() === 400;
  return {
    async verify(calls) {
      for (const { operation, args } of calls) {
        const metatype = contracts.get(operation);
        if (!metatype) continue; // Navigation and template application are not these three create contracts.
        const metadata = { type: 'body', metatype };
        const payload = clone(args[0]);
        let validated;
        try { validated = await pipe.transform(payload, metadata); }
        catch (error) { throw new Error(`${operation}: current source DTO rejected the compiled payload: ${JSON.stringify(error.getResponse?.() || error.message)}`, { cause: error }); }
        assert.ok(validated instanceof metatype, `${operation}: transform did not create a DTO instance`);
        // Controls prove that strict whitelisting and nested decorators really
        // execute, rather than passing because of missing/cross-realm metadata.
        await assert.rejects(() => pipe.transform({ ...clone(payload), __unexpectedProbeField: true }, metadata), badRequest, `${operation}: unknown field was accepted`);
        const invalid = clone(payload);
        if (operation === 'createRecipe') invalid.ingredients[0].quantity = 0;
        else if (operation === 'createPackingTemplate') invalid.items[0].quantity = 0;
        else invalid.initialDestination.latitude = 91;
        await assert.rejects(() => pipe.transform(invalid, metadata), badRequest, `${operation}: invalid nested value was accepted`);
        checked.add(operation);
      }
    },
    finish() {
      assert.deepEqual([...checked].sort(), [...contracts.keys()].sort(), 'Not all current-source create DTOs were exercised');
      console.log('PASS 3/3 current-source API DTO contracts (real ValidationPipe; strict whitelist/nested negative controls)');
    },
  };
}

function lookup(expression, scope) {
  assert.match(expression.trim(), /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\])*$/, `Unsupported WXML expression: ${expression}`);
  return expression.trim().replace(/\[(\d+)\]/g, '.$1').split('.').reduce((value, key) => value?.[key], scope);
}

function interpolate(value, scope) {
  const exact = /^\{\{\s*([^{}]+?)\s*\}\}$/.exec(value);
  if (exact) return lookup(exact[1], scope);
  return value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, expression) => String(lookup(expression, scope) ?? ''));
}

function attributes(node) {
  const result = {};
  for (const property of node.props) {
    assert.equal(property.type, 6, `Unexpected transformed directive in compiled WXML: ${node.tag}`);
    result[property.name] = property.value?.content ?? '';
  }
  return result;
}

// Parse WXML with the already-installed SFC parser, then evaluate only the simple
// paths generated by the mini-program compiler. Complex class strings stay raw.
function visibleNodes(children, scope) {
  const result = [];
  let branch = false, matched = false;
  for (const node of children) {
    if (node.type === 2) {
      result.push({ tag: '#text', text: node.content, attrs: {}, children: [] });
      continue;
    }
    if (node.type === 5) {
      result.push({ tag: '#text', text: String(lookup(node.content.content, scope) ?? ''), attrs: {}, children: [] });
      continue;
    }
    if (node.type === 3) continue; // Comment.
    assert.equal(node.type, 1, 'Unsupported compiled WXML node');
    const raw = attributes(node);
    if ('wx:if' in raw) {
      branch = true;
      matched = Boolean(interpolate(raw['wx:if'], scope));
      if (!matched) continue;
    } else if ('wx:elif' in raw) {
      assert.ok(branch, 'wx:elif without wx:if');
      if (matched) continue;
      matched = Boolean(interpolate(raw['wx:elif'], scope));
      if (!matched) continue;
    } else if ('wx:else' in raw) {
      assert.ok(branch, 'wx:else without wx:if');
      if (matched) continue;
      matched = true;
    } else {
      branch = false;
      matched = false;
    }
    const rows = 'wx:for' in raw ? interpolate(raw['wx:for'], scope) : [undefined];
    assert.ok(Array.isArray(rows), `WXML loop is not an array: ${raw['wx:for']}`);
    for (let index = 0; index < rows.length; index++) {
      const local = 'wx:for' in raw
        ? { ...scope, [raw['wx:for-item'] || 'item']: rows[index], [raw['wx:for-index'] || 'index']: index }
        : scope;
      const resolved = {};
      for (const [key, value] of Object.entries(raw)) {
        resolved[key] = /^(?:bind(?:input|tap|change)|value|placeholder|disabled)$/.test(key)
          ? interpolate(value, local) : value;
      }
      const descendants = visibleNodes(node.children, local);
      result.push({ tag: node.tag, attrs: resolved, children: descendants, text: descendants.map(child => child.text).join('') });
    }
  }
  return result;
}

function flatten(nodes) {
  return nodes.flatMap(node => [node, ...flatten(node.children)]);
}

function createPage(directory, name) {
  const hooks = {}, stops = [], notices = [], calls = [], templates = [];
  const context = { householdId: 'probe-house', membershipId: 'probe-member', householdName: 'Probe', roles: ['ADMIN'], effectivePermissions: { recipes: 'EDIT', trips: 'EDIT', packing_templates: 'EDIT' } };
  const rank = { VIEW: 1, EDIT: 2, MANAGE: 3 };
  const record = (operation, ...args) => calls.push({ operation, args: clone(args) });
  const makeTrip = (id, input = {}) => ({ id, version: 4, title: '原行程探针', status: 'PENDING', startsAt: '2026-10-25T00:00:00.000Z', endsAt: null, preparationGroups: [], members: [{ membershipId: context.membershipId, tripRole: 'OWNER', status: 'ACTIVE', canEdit: true, photoAdd: true, version: 1, membership: { user: { nickname: 'Probe' } } }], ...input });
  const trips = new Map([['probe-trip', makeTrip('probe-trip')]]);
  let recipe, definition;
  const uni = {
    showToast: input => notices.push(input.title),
    setNavigationBarTitle() {},
    navigateBack: () => record('navigateBack'),
    chooseLocation: input => input.success({ latitude: 40.5, longitude: 116.5, name: '探针营地', address: '虚构地点' }),
  };
  const vendor = {
    ref: vue.ref, computed: vue.computed, unref: vue.unref,
    watch: (...args) => { const stop = vue.watch(...args); stops.push(stop); return stop; },
    onUnmounted: handler => { hooks.unmounted = handler; },
    defineComponent: component => component,
    _export_sfc: component => component,
    onLoad: handler => { hooks.load = handler; }, onShow: handler => { hooks.show = handler; },
    onHide: handler => { hooks.hide = handler; }, onUnload: handler => { hooks.unload = handler; },
    e: (...parts) => Object.assign({}, ...parts),
    f: (rows, render) => { assert.ok(Array.isArray(rows), 'Unsupported vendor render-list input'); return rows.map((row, index) => render(row, index, index)); },
    // Event registration is deliberately transparent: these are the compiled
    // handler bodies, not the native WeChat event dispatcher.
    o: handler => handler, t: vue.toDisplayString, n: vue.normalizeClass,
    p: props => props, index: uni,
  };
  class ApiError extends Error { constructor(message, statusCode) { super(message); this.statusCode = statusCode; } }
  const api = {
    listRecipeCategories: async () => [],
    createRecipe: async input => { record('createRecipe', input); recipe = { ...clone(input), id: 'probe-recipe', version: 1, status: 'DRAFT' }; return clone(recipe); },
    getRecipe: async id => { assert.equal(id, recipe?.id); return clone(recipe); },
    listTrips: async () => clone([...trips.values()]),
    listPackingTemplates: async () => clone(templates),
    getTrip: async id => { assert.ok(trips.has(id), `Unknown trip: ${id}`); return clone(trips.get(id)); },
    listTripPackingItems: async () => [], listTripCandidates: async () => [],
    createPackingTemplate: async input => {
      record('createPackingTemplate', input);
      const template = { id: 'probe-template', name: input.name, description: input.description, archived: false, version: 1, createdById: context.membershipId,
        items: input.items.map((item, index) => ({ id: `source-${index}`, name: item.name, defaultQuantity: item.quantity == null ? null : String(item.quantity), unit: item.unit, note: item.note })) };
      templates.push(template);
      return clone(template);
    },
    applyPackingTemplate: async (tripId, templateId) => {
      record('applyPackingTemplate', tripId, templateId);
      const template = templates.find(item => item.id === templateId);
      assert.ok(trips.has(tripId) && template, 'Incorrect template application target');
      return { addedCount: template.items.length, skippedCount: 0, items: template.items.map(item => ({ id: `packed-${item.id}`, name: item.name, quantity: item.defaultQuantity, unit: item.unit, note: item.note, status: 'PENDING', sourceTemplateNameSnapshot: template.name })) };
    },
    createTrip: async input => { record('createTrip', input); const trip = makeTrip('probe-created-trip', clone(input)); trips.set(trip.id, trip); return clone(trip); },
  };
  const dependencies = {
    '../../common/vendor.js': vendor,
    '../../services/family-api.js': api,
    '../../services/session.js': { getStoredSession: () => context, refreshAccess: async () => context, canAccess: (value, module, level = 'VIEW') => (rank[value?.effectivePermissions?.[module]] || 0) >= rank[level] },
    '../../services/transport.js': { ApiError },
    '../../services/calendar-navigation.js': { takeCalendarTarget: () => undefined },
    '../../services/trip-native.js': {},
  };
  const sandbox = (filename, module = { exports: {} }) => ({
    module, exports: module.exports,
    require: id => { assert.ok(id in dependencies, `Unsupported import ${id} in ${filename}`); return dependencies[id]; },
    wx: { createPage: value => { definition = value; } },
    console, Promise, Error, ArrayBuffer, Date, Number, setTimeout, clearTimeout,
    setInterval: () => 1, clearInterval() {},
  });
  if (name === 'camping') {
    const module = { exports: {} };
    vm.runInNewContext(requiredFile(directory, 'services/trip-form.js'), sandbox('services/trip-form.js', module), { filename: 'compiled-trip-form.js', timeout: 1000 });
    dependencies['../../services/trip-form.js'] = module.exports;
  }
  const filename = `pages/${name}/index.js`;
  vm.runInNewContext(requiredFile(directory, filename), sandbox(filename), { filename: `compiled-${name}.js`, timeout: 1000 });
  assert.equal(typeof definition?.setup, 'function', `No compiled page setup: ${name}`);
  const render = definition.setup({});
  assert.equal(typeof render, 'function', `No compiled page render: ${name}`);
  const parsed = parseSfc(`<template>${requiredFile(directory, `pages/${name}/index.wxml`)}</template>`);
  assert.equal(parsed.errors.length, 0, `Invalid compiled WXML: ${parsed.errors.join('; ')}`);
  const ast = parsed.descriptor.template?.ast;
  assert.ok(ast, `Missing compiled WXML AST: ${name}`);
  function nodes() {
    // The real bundled vendor sets r0=1 when rendering pages/components.
    return flatten(visibleNodes(ast.children, { r0: 1, ...render({}, []) }));
  }
  function action(label, contains = false) {
    const matches = nodes().filter(node => typeof node.attrs.bindtap === 'function' && (contains ? text(node.text).includes(label) : text(node.text) === label));
    assert.equal(matches.length, 1, `Expected one visible action '${label}', found ${matches.length} in ${name}`);
    return matches[0];
  }
  function control(placeholder, index = 0) {
    const matches = nodes().filter(node => ['input', 'textarea'].includes(node.tag) && node.attrs.placeholder === placeholder);
    assert.ok(matches[index], `Missing visible input '${placeholder}' [${index}] in ${name}`);
    return matches[index];
  }
  function dispatch(node, event, value) {
    assert.ok(!('disabled' in node.attrs) || [false, 0, null, undefined].includes(node.attrs.disabled), `Control is disabled: ${node.attrs.placeholder || node.text}`);
    assert.equal(typeof node.attrs[event], 'function', `Missing ${event} for '${node.attrs.placeholder || text(node.text)}'`);
    return node.attrs[event]({ detail: { value } });
  }
  return {
    calls, notices, nodes,
    show: async () => { hooks.load?.({}); assert.equal(typeof hooks.show, 'function', `No onShow hook: ${name}`); await hooks.show(); },
    tap: (label, contains) => dispatch(action(label, contains), 'bindtap'),
    input: (placeholder, value, index) => dispatch(control(placeholder, index), 'bindinput', value),
    value: (placeholder, index) => control(placeholder, index).attrs.value,
    count: placeholder => nodes().filter(node => ['input', 'textarea'].includes(node.tag) && node.attrs.placeholder === placeholder).length,
    date: (value, index = 0) => { const pickers = nodes().filter(node => node.tag === 'picker' && node.attrs.mode === 'date'); assert.ok(pickers[index], 'Missing visible date picker'); return dispatch(pickers[index], 'bindchange', value); },
    contains: value => nodes().some(node => node.tag === '#text' && text(node.text).includes(value)),
    dispose: () => { hooks.unload?.(); hooks.unmounted?.(); stops.forEach(stop => stop()); },
  };
}

async function recipeCase(directory) {
  const page = createPage(directory, 'recipe-editor');
  try {
    await page.show();
    page.input('例如：番茄炒蛋', '探针菜');
    page.input('食材名称，例如：鸡蛋', '鸡蛋');
    page.input('例如：2', '2.125');
    page.input('例如：个、克、把', '个');
    page.input('例如：生抽', '生抽');
    page.input('例如：番茄切块，鸡蛋打散备用。', '打散后炒熟');
    assert.equal(page.value('例如：番茄炒蛋'), '探针菜');
    await page.tap('＋ 再加一种食材');
    await page.tap('＋ 再加一个步骤');
    assert.equal(page.count('食材名称，例如：鸡蛋'), 2);
    assert.equal(page.value('食材名称，例如：鸡蛋'), '鸡蛋');
    assert.equal(page.value('例如：2'), '2.125');
    assert.equal(page.value('例如：个、克、把'), '个');
    assert.equal(page.value('例如：生抽'), '生抽');
    assert.equal(page.value('例如：番茄切块，鸡蛋打散备用。'), '打散后炒熟');
    page.input('食材名称，例如：鸡蛋', '番茄', 1);
    page.input('写下接着怎么做，例如：倒入鸡蛋翻炒至凝固。', '加入番茄翻炒');
    await page.tap('保存草稿');
    const writes = page.calls.filter(call => call.operation === 'createRecipe');
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].args[0], { name: '探针菜', ingredients: [{ name: '鸡蛋', quantity: 2.125, unit: '个' }, { name: '番茄', unit: 'g' }], seasonings: ['生抽'], steps: ['打散后炒熟', '加入番茄翻炒'] });
    assert.equal(page.calls.filter(call => call.operation === 'navigateBack').length, 1);
    return page.calls;
  } finally { page.dispose(); }
}

async function templateCase(directory) {
  const page = createPage(directory, 'camping');
  try {
    await page.show();
    await page.tap('原行程探针', true);
    await page.tap('从模板添加 ▾');
    await page.tap('＋ 新建行李模板，完成后返回本行程');
    page.input('例如：烧烤、过夜露营', ' 烧烤 ');
    page.input('例如：两家人周末烧烤用', '探针说明');
    page.input('例如：蛋卷桌、天幕、烧烤炉', ' 天幕 ');
    page.input('例如：1', '1');
    page.input('例如：张、顶、个', ' 顶 ');
    page.input('例如：带上配套地钉和风绳', '地钉');
    await page.tap('＋ 添加下一件物品');
    assert.equal(page.count('例如：蛋卷桌、天幕、烧烤炉'), 2);
    assert.equal(page.value('例如：蛋卷桌、天幕、烧烤炉'), ' 天幕 ');
    assert.equal(page.value('例如：1'), '1');
    assert.equal(page.value('例如：张、顶、个'), ' 顶 ');
    assert.equal(page.value('例如：带上配套地钉和风绳'), '地钉');
    page.input('例如：蛋卷桌、天幕、烧烤炉', '折叠椅', 1);
    page.input('例如：1', '2', 1);
    page.input('例如：张、顶、个', '把', 1);
    await page.tap('保存模板并返回行程');
    assert.ok(page.contains('原行程探针'), 'Template save did not return to the original trip');
    const writes = page.calls.filter(call => call.operation === 'createPackingTemplate');
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].args[0], { name: '烧烤', description: '探针说明', items: [{ name: '天幕', quantity: 1, unit: '顶', note: '地钉', sortOrder: 0 }, { name: '折叠椅', quantity: 2, unit: '把', note: null, sortOrder: 1 }] });
    assert.equal(page.calls.filter(call => call.operation === 'applyPackingTemplate').length, 0, 'Template creation must not apply automatically');
    await page.tap('加入本次行程');
    const applications = page.calls.filter(call => call.operation === 'applyPackingTemplate');
    assert.deepEqual(applications.map(call => call.args), [['probe-trip', 'probe-template']]);
    assert.ok(page.contains('来自模板：烧烤'));
    assert.ok(page.contains('天幕') && page.contains('折叠椅'));
    return page.calls;
  } finally { page.dispose(); }
}

async function destinationCase(directory) {
  const page = createPage(directory, 'camping');
  try {
    await page.show();
    await page.tap('📍 先选目的地，再安排出行');
    assert.equal(page.value('例如：周末去溪边露营'), '探针营地');
    assert.equal(page.value('例如：营地名称或城市'), '探针营地');
    assert.ok(page.notices.includes('目的地已选好，请选择出发日期后保存行程'));
    assert.equal(page.calls.length, 0, 'Location selection must not create a trip');
    page.input('例如：周末去溪边露营', '探针周末行程');
    page.date('2026-10-28');
    await page.tap('保存并准备行李');
    const writes = page.calls.filter(call => call.operation === 'createTrip');
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].args[0], { title: '探针周末行程', destination: '探针营地', startsAt: '2026-10-28T08:00:00+08:00', initialDestination: { title: '探针营地', latitude: 40.5, longitude: 116.5 } });
    assert.ok(page.notices.includes('行程已创建，接下来添加行李或套用模板'));
    return page.calls;
  } finally { page.dispose(); }
}

async function main() {
  const options = argumentsFor(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/verify-compiled-client.cjs [--dir <mp-weixin directory>] [--api-contracts]');
    return;
  }
  for (const relative of ['common/vendor.js', 'app.json', 'services/trip-form.js', 'pages/recipe-editor/index.js', 'pages/recipe-editor/index.wxml', 'pages/recipe-editor/index.wxss', 'pages/camping/index.js', 'pages/camping/index.wxml', 'pages/camping/index.wxss']) requiredFile(options.directory, relative);
  const clientRequire = createRequire(path.join(repository, 'apps/client/package.json'));
  vue = clientRequire('vue');
  ({ parse: parseSfc } = clientRequire('vue/compiler-sfc'));
  const contracts = options.apiContracts ? createApiContracts() : undefined;
  console.log(`Compiled client: ${options.directory}`);
  console.log('Vue reactivity + compiled JS/WXML; simulated vendor/native callbacks/backend. Not native-device acceptance.');
  if (contracts) console.log('API contracts: current source DTOs + real Nest ValidationPipe; persistence/auth/services remain simulated.');
  for (const [name, verify] of [['recipe input/add rows/exact save', recipeCase], ['trip template create/return/explicit apply', templateCase], ['destination callback/date/exact trip save', destinationCase]]) {
    const calls = await verify(options.directory);
    if (contracts) await contracts.verify(calls);
    console.log(`PASS ${name}`);
  }
  console.log('PASS 3/3 compiled-client scenarios');
  contracts?.finish();
}

main().catch(error => {
  console.error(`FAIL compiled-client: ${error.stack || error}`);
  process.exitCode = 1;
});
