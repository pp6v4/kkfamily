const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('vue/compiler-sfc');
const { renderToString } = require('vue/server-renderer');
class ApiError extends Error { constructor(message, statusCode) { super(message); this.statusCode = statusCode; } }
const context = { householdId: 'house-a', membershipId: 'member-a', householdName: '测试家庭', accessToken: 'test-token', roles: [], effectivePermissions: { recipes: 'EDIT' } };
const recipe = { id: 'recipe-a', version: 3, name: '番茄炒蛋', status: 'DRAFT', coverAssetId: null, category: null, ingredients: [{ ingredient: { id: 'i', name: '鸡蛋' }, quantity: '2', unit: '个' }], seasonings: [{ name: '盐' }], steps: ['炒熟'] };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const tick = () => new Promise(setImmediate);
function form(api = {}, access) {
  const life = {}, toasts = [], routes = [], pickers = [];
  let stored = context, liveRecipe = { ...recipe };
  const storage = new Map();
  const uni = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, JSON.parse(JSON.stringify(value))), removeStorageSync: key => storage.delete(key), showModal() {}, showToast: input => toasts.push(input.title), setNavigationBarTitle() {}, navigateBack: () => routes.push('back'), chooseMedia: input => pickers.push(input), getFileSystemManager: () => ({ readFile: input => input.success({ data: new ArrayBuffer(4) }) }) };
  const defaults = {
    listRecipeCategories: async () => [], getRecipe: async () => liveRecipe,
    createRecipe: async input => { liveRecipe = { ...recipe, ...input, version: 1 }; return liveRecipe; },
    updateRecipe: async (id, input) => { liveRecipe = { ...liveRecipe, ...input, version: input.expectedVersion + 1 }; return liveRecipe; },
    createMediaUploadIntent: async () => ({ id: 'intent-a', uploadPath: '/media/intent-a/content' }),
    uploadMediaContent: async () => ({ checksumSha256: 'fictional-checksum' }),
    confirmMediaAsset: async () => { liveRecipe = { ...liveRecipe, version: liveRecipe.version + 1, coverAssetId: 'asset-a' }; return { asset: { id: 'asset-a' }, ownerVersion: liveRecipe.version }; },
    getMediaReadUrl: async () => ({ path: '/private/asset-a?signature=fake' }), publicMediaUrl: value => value,
    ...api,
  };
  const session = { getStoredSession: () => stored, canAccess: (c, module, level = 'VIEW') => ({ VIEW: 1, EDIT: 2, MANAGE: 3 }[c?.effectivePermissions?.[module]] || 0) >= ({ VIEW: 1, EDIT: 2, MANAGE: 3 }[level]), refreshAccess: async () => access ? access() : stored };
  const filename = path.resolve(__dirname, '../src/pages/recipe-editor/index.vue');
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename });
  const script = compileScript(descriptor, { id: 'recipe-test', inlineTemplate: false });
  const code = ts.transpileModule(script.content, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const deps = { vue, '@dcloudio/uni-app': { onLoad: fn => life.load = fn, onShow: fn => life.show = fn, onHide: fn => life.hide = fn, onUnload: fn => life.unload = fn }, '../../services/session': session, '../../services/family-api': defaults, '../../services/transport': { ApiError } };
  const draftModule = { exports: {} };
  const draftCode = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/services/recipe-draft.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(draftCode, { module: draftModule, exports: draftModule.exports, uni, Date, Error, Math, JSON });
  deps['../../services/recipe-draft'] = draftModule.exports;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: id => { if (id in deps) return deps[id]; throw new Error('Unexpected import ' + id); }, uni, Date, Error, Promise, setTimeout, clearTimeout });
  const page = module.exports.default.setup({}, { expose() {} });
  async function show(id = recipe.id) { const loaded = life.load({ id }); return life.show ? life.show() : loaded; }
  return { page, life, show, toasts, routes, pickers, uni, setStored: value => stored = value, setRecipe: value => liveRecipe = value };
}
function fill(page) { page.name.value = ' 新菜 '; page.ingredients.value = [{ name: ' 鸡蛋 ', quantity: '2.125', unit: ' 个 ' }]; page.seasonings.value = [' 盐 ', '']; page.steps.value = [' 炒熟 ']; }
async function renderedEditor(page) {
  const filename = path.resolve(__dirname, '../src/pages/recipe-editor/index.vue'), { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename });
  const script = compileScript(descriptor, { id: 'recipe-events', inlineTemplate: false });
  const compiled = compileTemplate({ source: descriptor.template.content, filename, id: 'recipe-events', compilerOptions: { bindingMetadata: script.bindings, isCustomElement: tag => ['view', 'text', 'input', 'textarea', 'picker', 'image', 'button'].includes(tag) } });
  assert.deepEqual(compiled.errors, []);
  const module = { exports: {} }, output = ts.transpileModule(compiled.code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(output, { module, exports: module.exports, require: id => { assert.equal(id, 'vue'); return vue; } });
  let tree;
  const app = vue.createSSRApp({ setup: () => () => { tree = module.exports.render({}, [], {}, vue.proxyRefs(page)); return tree; } });
  await renderToString(app);
  return tree;
}
function descendants(node, predicate) {
  const result = [];
  function visit(item) { if (!item || typeof item !== 'object') return; if (predicate(item)) result.push(item); if (Array.isArray(item.children)) item.children.forEach(visit); }
  visit(node); return result;
}
function vnodeText(node) { return typeof node.children === 'string' ? node.children : Array.isArray(node.children) ? node.children.map(vnodeText).join('') : ''; }
function hasClass(node, name) { return typeof node.props?.class === 'string' && node.props.class.split(/\s+/).includes(name); }
function sectionAction(tree, title, className, index = 0) {
  const section = descendants(tree, node => hasClass(node, 'section') && descendants(node, child => hasClass(child, 'title') && vnodeText(child).startsWith(title)).length)[0];
  assert.ok(section, `Missing rendered section: ${title}`);
  const action = descendants(section, node => hasClass(node, className))[index];
  assert.ok(action && typeof action.props?.onTap === 'function', `Missing rendered ${title} ${className} action ${index + 1}`);
  return action;
}
async function tapAction(page, title, className, index = 0) { const action = sectionAction(await renderedEditor(page), title, className, index); await action.props.onTap({}); return action; }

test('Rendered ingredient and seasoning removal changes only the draft until explicit save, preserving other rows and exact update payload', async () => {
  const stored = { ...recipe, ingredients: [{ ingredient: { name: '鸡蛋' }, quantity: '2.125', unit: '个' }, { ingredient: { name: '番茄' }, quantity: '1.500', unit: '个' }, { ingredient: { name: '葱' }, quantity: null, unit: '把' }], seasonings: [{ name: '盐' }, { name: '生抽' }, { name: '食用油' }] };
  const before = JSON.stringify(stored), writes = [];
  const { page, show } = form({ getRecipe: async () => stored, updateRecipe: async (id, input) => { writes.push([id, JSON.parse(JSON.stringify(input))]); return { ...stored, version: 4 }; } });
  await show(); await tapAction(page, '食材', 'remove', 1); await tapAction(page, '调料', 'remove', 1);
  assert.equal(writes.length, 0); assert.equal(JSON.stringify(stored), before);
  assert.deepEqual(JSON.parse(JSON.stringify(page.ingredients.value)), [{ name: '鸡蛋', quantity: '2.125', unit: '个' }, { name: '葱', quantity: '', unit: '把' }]);
  assert.deepEqual(Array.from(page.seasonings.value), ['盐', '食用油']); assert.equal(page.name.value, recipe.name); assert.deepEqual(Array.from(page.steps.value), recipe.steps);
  assert.equal(await page.persist(false), true);
  assert.deepEqual(writes, [[recipe.id, { name: recipe.name, ingredients: [{ name: '鸡蛋', quantity: 2.125, unit: '个' }, { name: '葱', unit: '把' }], seasonings: ['盐', '食用油'], steps: ['炒熟'], categoryId: null, expectedVersion: 3 }]]);
});

test('The last rendered seasoning can be cleared and explicitly saved as an empty optional list', async () => {
  const writes = []; const { page, show } = form({ updateRecipe: async (id, input) => { writes.push([id, JSON.parse(JSON.stringify(input))]); return { ...recipe, seasonings: [], version: 4 }; } });
  await show(); const action = await tapAction(page, '调料', 'remove'); assert.equal(vnodeText(action), '清空');
  assert.deepEqual(Array.from(page.seasonings.value), ['']); assert.equal(writes.length, 0);
  assert.equal(await page.persist(false), true); assert.deepEqual(writes[0][1].seasonings, []); assert.deepEqual(writes[0][1].ingredients, [{ name: '鸡蛋', quantity: 2, unit: '个' }]);
  assert.deepEqual(Array.from(page.seasonings.value), ['']); assert.equal(page.recipeVersion.value, 4);
});

test('The last rendered ingredient can be cleared for replacement while save still requires one ingredient', async () => {
  const writes = []; const { page, show, toasts } = form({ updateRecipe: async (id, input) => { writes.push([id, JSON.parse(JSON.stringify(input))]); return { ...recipe, version: 4 }; } });
  await show(); const action = await tapAction(page, '食材', 'remove'); assert.equal(vnodeText(action), '清空');
  assert.deepEqual(JSON.parse(JSON.stringify(page.ingredients.value)), [{ name: '', quantity: '', unit: 'g' }]); assert.equal(writes.length, 0);
  assert.equal(await page.persist(false), false); assert.match(toasts.at(-1), /至少填写一种食材/); assert.equal(writes.length, 0);
  assert.equal(page.name.value, recipe.name); assert.deepEqual(Array.from(page.seasonings.value), ['盐']); assert.deepEqual(Array.from(page.steps.value), recipe.steps);
  Object.assign(page.ingredients.value[0], { name: '牛肉', quantity: '1.125', unit: '克' }); assert.equal(await page.persist(false), true);
  assert.deepEqual(writes[0][1].ingredients, [{ name: '牛肉', quantity: 1.125, unit: '克' }]); assert.deepEqual(writes[0][1].seasonings, ['盐']); assert.equal(writes[0][1].expectedVersion, 3);
});

test('Rendered add/remove rows keep new recipe inputs and deletion failures retain the reduced draft', async () => {
  let writes = 0; const { page, show, toasts } = form({ createRecipe: async () => { writes++; throw new ApiError('版本冲突', 409); } });
  await show(''); fill(page); page.seasonings.value = ['盐'];
  await tapAction(page, '食材', 'add'); await tapAction(page, '调料', 'add');
  assert.equal(page.ingredients.value.length, 2); assert.equal(page.seasonings.value.length, 2);
  await tapAction(page, '食材', 'remove', 1); await tapAction(page, '调料', 'remove', 1);
  assert.equal(page.ingredients.value.length, 1); assert.deepEqual(Array.from(page.seasonings.value), ['盐']); assert.equal(page.name.value, ' 新菜 ');
  const before = JSON.stringify(page.snapshot()); assert.equal(await page.persist(false), false);
  assert.equal(writes, 1); assert.equal(toasts.at(-1), '版本冲突'); assert.equal(JSON.stringify(page.snapshot()), before);
});

test('Removal ignores invalid indices and stale rendered actions during save, after hiding or without edit access', async () => {
  const pending = deferred(); const { page, show, life } = form({ updateRecipe: () => pending.promise }); await show();
  page.addIngredient(); page.addSeasoning(); const tree = await renderedEditor(page), ingredient = sectionAction(tree, '食材', 'remove'), seasoning = sectionAction(tree, '调料', 'remove');
  const before = JSON.stringify(page.snapshot());
  for (const index of [-1, 0.5, 2, NaN]) { page.removeIngredient(index); page.removeSeasoning(index); }
  assert.equal(JSON.stringify(page.snapshot()), before);
  const saving = page.persist(false); await ingredient.props.onTap({}); await seasoning.props.onTap({}); assert.equal(JSON.stringify(page.snapshot()), before);
  pending.resolve({ ...recipe, version: 4 }); await saving;
  page.session.value = { ...context, effectivePermissions: { recipes: 'VIEW' } }; const withoutAccess = JSON.stringify(page.snapshot());
  await ingredient.props.onTap({}); await seasoning.props.onTap({}); assert.equal(JSON.stringify(page.snapshot()), withoutAccess);
  life.hide(); await ingredient.props.onTap({}); await seasoning.props.onTap({});
  assert.deepEqual(Array.from(page.seasonings.value), ['']); assert.equal(page.ingredients.value[0].name, ''); assert.equal(page.session.value, undefined);
});

test('Recipe editor requests editing permission before reading recipes or categories', async () => {
  let reads = 0;
  const { page, show } = form({ listRecipeCategories: async () => { reads++; return []; }, getRecipe: async () => { reads++; return recipe; } }, async () => ({ ...context, effectivePermissions: { recipes: 'VIEW' } }));
  await show(); assert.equal(reads, 0); assert.equal(page.name.value, ''); assert.match(page.loadError.value, /权限/);
});
test('Recipe editor ignores late categories and details after hide/unload or identity change', async () => {
  for (const stage of ['categories', 'details']) for (const ending of ['hide', 'unload', 'identity']) {
    const wait = deferred(); let details = 0;
    const { page, show, life, setStored } = form({ listRecipeCategories: () => stage === 'categories' ? wait.promise : Promise.resolve([]), getRecipe: () => { details++; return stage === 'details' ? wait.promise : Promise.resolve(recipe); } });
    const pending = show(); await tick();
    if (ending === 'identity') setStored({ ...context, membershipId: 'member-b' }); else life[ending]();
    wait.resolve(stage === 'categories' ? [] : recipe); await pending;
    assert.equal(page.name.value, ''); assert.equal(page.categories.value.length, 0); assert.equal(page.session.value, undefined); assert.equal(page.loading.value, false);
    if (stage === 'categories') assert.equal(details, 0);
  }
});
test('Recipe editor keeps only the latest authorized recipe load and clears old cover URLs', async () => {
  const wait = deferred(); const { page, show } = form({ getRecipe: id => id === recipe.id ? wait.promise : Promise.resolve({ ...recipe, id, name: '新页面' }) });
  const old = show(); await tick(); await show('recipe-b'); wait.resolve(recipe); await old;
  assert.equal(page.recipeId.value, 'recipe-b'); assert.equal(page.name.value, '新页面'); assert.equal(page.coverPreview.value, '');
});
test('Recipe creation is single-flight, trims inputs, and saves exact amounts without seasoning quantities', async () => {
  const pending = deferred(), writes = [];
  const { page, show } = form({ createRecipe: input => { writes.push(input); return pending.promise; } });
  await show(''); fill(page); const first = page.persist(false), second = page.persist(false);
  assert.equal(writes.length, 1); pending.resolve({ ...recipe, version: 1 }); await Promise.all([first, second]);
  assert.equal(writes[0].name, '新菜'); assert.equal(writes[0].ingredients[0].quantity, 2.125); assert.equal(writes[0].ingredients[0].unit, '个'); assert.deepEqual(Array.from(writes[0].seasonings), ['盐']);
  assert.equal(page.recipeId.value, recipe.id); assert.equal(page.recipeVersion.value, 1); assert.equal(page.saving.value, false);
});
test('Recipe amounts reject malformed, nonpositive and overprecision values before sending requests', async () => {
  let writes = 0; const { page, show } = form({ createRecipe: async () => { writes++; return recipe; } });
  await show(''); fill(page);
  for (const value of ['abc', '0', '-1', '0.0001', '1.2345', '1e3', '0x10', 'Infinity', '1000000000']) { page.ingredients.value[0].quantity = value; await page.persist(false); }
  assert.equal(writes, 0); page.ingredients.value[0].quantity = ''; await page.persist(false); assert.equal(writes, 1);
});

test('Recipe add-row actions stop at backend array limits without submitting or losing existing inputs', async () => {
  let writes = 0; const { page, show, toasts } = form({ createRecipe: async () => { writes++; return recipe; } });
  await show(''); fill(page);
  for (const [field, action, limit, value] of [
    ['ingredients', 'addIngredient', 100, { name: '鸡蛋', quantity: '2', unit: '个' }],
    ['steps', 'addStep', 50, '炒熟'], ['seasonings', 'addSeasoning', 40, '盐'],
  ]) {
    page[field].value = Array.from({ length: limit - 1 }, () => typeof value === 'string' ? value : { ...value });
    page[action](); assert.equal(page[field].value.length, limit);
    page[action](); assert.equal(page[field].value.length, limit); assert.match(toasts.at(-1), new RegExp(String(limit)));
    if (field === 'ingredients') assert.equal(page[field].value[0].name, '鸡蛋'); else assert.equal(page[field].value[0], value);
  }
  assert.equal(writes, 0); assert.equal(page.name.value, ' 新菜 ');
});

test('Recipe save rejects backend length and array-limit violations locally while retaining drafts', async () => {
  let writes = 0; const { page, show, toasts } = form({ createRecipe: async () => { writes++; return recipe; } });
  await show('');
  const cases = [
    [() => { page.name.value = '名'.repeat(81); }, /80/],
    [() => { page.ingredients.value = Array.from({ length: 101 }, (_, i) => ({ name: `食材${i}`, quantity: '', unit: '克' })); }, /100/],
    [() => { page.ingredients.value[0].name = '材'.repeat(61); }, /60/],
    [() => { page.ingredients.value[0].unit = '位'.repeat(13); }, /12/],
    [() => { page.steps.value = Array.from({ length: 51 }, (_, i) => `步骤${i}`); }, /50/],
    [() => { page.steps.value = ['法'.repeat(4001)]; }, /4000/],
    [() => { page.seasonings.value = Array.from({ length: 41 }, (_, i) => `调料${i}`); }, /40/],
  ];
  for (const [mutate, expected] of cases) {
    fill(page); mutate(); const original = page.snapshot(); assert.equal(await page.persist(false), false);
    assert.match(toasts.at(-1), expected); assert.equal(JSON.stringify(page.snapshot()), JSON.stringify(original));
  }
  assert.equal(writes, 0);
});

test('Recipe exact backend maxima remain savable without silent truncation', async () => {
  let input; const { page, show } = form({ createRecipe: async value => { input = value; return { ...recipe, version: 1 }; } });
  await show(''); page.name.value = '名'.repeat(80);
  page.ingredients.value = Array.from({ length: 100 }, (_, i) => ({ name: i ? `食材${i}` : '材'.repeat(60), quantity: '', unit: '位'.repeat(12) }));
  page.steps.value = Array.from({ length: 50 }, () => '法'.repeat(4000)); page.seasonings.value = Array.from({ length: 40 }, (_, i) => `调料${i}`);
  assert.equal(await page.persist(false), true);
  assert.equal(input.name.length, 80); assert.equal(input.ingredients.length, 100); assert.equal(input.ingredients[0].name.length, 60); assert.equal(input.ingredients[0].unit.length, 12);
  assert.equal(input.steps.length, 50); assert.equal(input.steps[0].length, 4000); assert.equal(input.seasonings.length, 40);
});
test('Recipe saves cannot navigate or restore content after hiding, unloading or changing identity', async () => {
  for (const ending of ['hide', 'unload', 'identity']) {
    const pending = deferred(); const { page, show, life, setStored, routes, toasts } = form({ updateRecipe: () => pending.promise });
    await show(); const writing = page.persist(true);
    if (ending === 'identity') setStored(undefined); else life[ending]();
    pending.resolve({ ...recipe, version: 4 }); await writing;
    assert.equal(routes.length, 0); assert.equal(toasts.length, 0); assert.equal(page.name.value, ''); assert.equal(page.saving.value, false);
  }
});
test('Recipe version conflicts keep the draft; revoked editing clears private fields and preview', async () => {
  for (const code of [401, 403, 409]) {
    const { page, show } = form({ updateRecipe: async () => { throw new ApiError('failure-' + code, code); } });
    await show(); page.name.value = '未保存改动'; await page.persist(false);
    if (code === 409) { assert.equal(page.name.value, '未保存改动'); assert.equal(page.recipeVersion.value, 3); }
    else { assert.equal(page.name.value, ''); assert.equal(page.session.value, undefined); }
    assert.equal(page.saving.value, false);
  }
});

const photo = { tempFilePath: '/tmp/photo.jpg', size: 4 };
for (const order of ['show-first', 'callback-first']) test('Recipe cover preserves unsaved text and original target after native return: ' + order, async () => {
  const intents = [], textWrites = [];
  const { page, show, life, pickers, toasts } = form({ createMediaUploadIntent: async input => { intents.push(input); return { id: 'intent-a', uploadPath: '/upload' }; }, updateRecipe: async (...args) => { textWrites.push(args); return recipe; } });
  await show(); page.name.value = '未保存菜名'; page.steps.value = ['未保存步骤'];
  const upload = page.chooseCover(); await page.chooseCover(); assert.equal(pickers.length, 1); assert.equal(page.coverUploading.value, true);
  life.hide(); assert.equal(page.name.value, ''); assert.equal(page.coverPreview.value, '');
  if (order === 'callback-first') { pickers[0].success({ tempFiles: [photo] }); await tick(); assert.equal(intents.length, 0); await life.show(); }
  else { await life.show(); pickers[0].success({ tempFiles: [photo] }); }
  await upload;
  assert.equal(intents.length, 1); assert.equal(intents[0].ownerId, recipe.id); assert.equal(intents[0].expectedOwnerVersion, 3); assert.equal(intents[0].byteSize, 4); assert.equal(intents[0].mimeType, 'image/jpeg');
  assert.equal(textWrites.length, 0); assert.equal(page.name.value, '未保存菜名'); assert.deepEqual(Array.from(page.steps.value), ['未保存步骤']); assert.equal(page.recipeVersion.value, 4); assert.equal(page.coverAssetId.value, 'asset-a'); assert.match(page.coverPreview.value, /signature/); assert.equal(toasts.at(-1), '封面已保存'); assert.equal(page.coverUploading.value, false);
});

test('Cancelling native cover selection restores a new unsaved recipe and makes no writes', async () => {
  let writes = 0; const { page, show, life, pickers, toasts } = form({ createRecipe: async () => { writes++; return recipe; }, createMediaUploadIntent: async () => { writes++; } });
  await show(''); fill(page); const pending = page.chooseCover(); life.hide();
  pickers[0].fail({ errMsg: 'chooseMedia:fail cancel' }); await life.show(); await pending;
  assert.equal(writes, 0); assert.equal(page.recipeId.value, ''); assert.equal(page.name.value, ' 新菜 '); assert.equal(toasts.length, 0); assert.equal(page.coverUploading.value, false);
});

test('New recipe image stays local until save; a failed upload retains its saved draft for retry', async () => {
  let creates = 0, uploads = 0; const intents = [];
  const { page, show, pickers } = form({ createRecipe: async input => { creates++; return { ...recipe, ...input, version: 3 }; }, createMediaUploadIntent: async input => { intents.push(input); return { id: 'intent-a', uploadPath: '/upload' }; }, uploadMediaContent: async () => { if (++uploads === 1) throw new Error('network'); return { checksumSha256: 'fake' }; } });
  await show(''); fill(page);
  const first = page.chooseCover(); pickers[0].success({ tempFiles: [photo] }); await first;
  assert.equal(creates, 0); assert.equal(intents.length, 0); assert.equal(page.recipeId.value, ''); assert.equal(page.coverPreview.value, photo.tempFilePath);
  assert.equal(await page.persist(false), false);
  assert.equal(creates, 1); assert.equal(page.recipeId.value, recipe.id); assert.equal(page.recipeVersion.value, 3); assert.equal(page.coverUploading.value, false);
  assert.equal(page.pendingCover.value.tempFilePath, photo.tempFilePath); assert.match(page.coverError.value, /文字已保存/);
  assert.equal(await page.persist(false), true);
  assert.equal(creates, 1); assert.equal(intents.length, 2); assert.equal(page.coverAssetId.value, 'asset-a'); assert.equal(page.recipeVersion.value, 5);
  assert.equal(intents[0].expectedOwnerVersion, 3); assert.equal(intents[1].expectedOwnerVersion, 4); assert.equal(page.pendingCover.value, undefined);
});

test('Blank recipe can choose a cover and add fields; validation runs only on explicit save', async () => {
  let writes = 0;
  const { page, show, pickers, toasts } = form({ createRecipe: async () => { writes++; return recipe; }, createMediaUploadIntent: async () => { writes++; } });
  await show(''); assert.deepEqual(toasts, []);
  page.addIngredient(); page.addSeasoning(); page.addStep(); assert.deepEqual(toasts, []);
  const selecting = page.chooseCover(); pickers[0].success({ tempFiles: [photo] }); await selecting;
  assert.equal(writes, 0); assert.equal(page.recipeId.value, ''); assert.equal(page.coverPreview.value, photo.tempFilePath);
  assert.match(toasts.at(-1), /保存菜谱时上传/);
  assert.equal(await page.persist(false), false); assert.match(toasts.at(-1), /菜品名称/);
  page.name.value = '番茄炒蛋'; assert.equal(await page.persist(false), false); assert.match(toasts.at(-1), /食材/);
  page.ingredients.value[0].name = '鸡蛋'; assert.equal(await page.persist(false), false); assert.match(toasts.at(-1), /做法/);
  assert.equal(writes, 0); assert.equal(page.pendingCover.value.tempFilePath, photo.tempFilePath);
});

test('New recipe staged cover saves text then uploads to the returned id before navigating', async () => {
  const intents = [], transfers = [];
  const { page, show, pickers, routes } = form({ createMediaUploadIntent: async input => { intents.push(input); return { id: 'intent-a', uploadPath: '/media/intent-a/content' }; }, uploadMediaContent: async (path, bytes, mime) => { transfers.push([path, bytes.byteLength, mime]); return { checksumSha256: 'fictional-checksum' }; } });
  await show(''); const selecting = page.chooseCover(); pickers[0].success({ tempFiles: [photo] }); await selecting;
  fill(page); assert.equal(await page.persist(true), true);
  assert.equal(intents.length, 1); assert.equal(intents[0].ownerId, recipe.id); assert.equal(intents[0].expectedOwnerVersion, 1);
  assert.deepEqual(transfers, [['/media/intent-a/content', 4, 'image/jpeg']]); assert.deepEqual(routes, ['back']);
  assert.equal(page.recipeVersion.value, 2); assert.equal(page.pendingCover.value, undefined); assert.equal(page.coverAssetId.value, 'asset-a');
});

test('Staged cover retry never claims edited text was saved when validation or text update fails', async () => {
  const { page, show, pickers, toasts } = form({ uploadMediaContent: async () => { throw new Error('offline'); }, updateRecipe: async () => { throw new ApiError('版本冲突', 409); } });
  await show(''); fill(page); const selecting = page.chooseCover(); pickers[0].success({ tempFiles: [photo] }); await selecting;
  assert.equal(await page.persist(false), false); assert.match(page.coverError.value, /文字已保存/);
  page.name.value = '尚未保存的新名字'; assert.equal(await page.persist(false), false);
  assert.equal(page.coverError.value, ''); assert.equal(page.name.value, '尚未保存的新名字'); assert.equal(toasts.at(-1), '版本冲突');
  page.name.value = ''; assert.equal(await page.persist(false), false); assert.equal(page.coverError.value, ''); assert.match(toasts.at(-1), /菜品名称/);
  assert.equal(page.pendingCover.value.tempFilePath, photo.tempFilePath);
});

test('Lost cover confirmation response retries the same intent before saving text with its own confirmed version', async () => {
  let confirms = 0, binary = 0, creates = 0;
  const confirmations = [], writes = [];
  const { page, show, pickers } = form({
    createRecipe: async input => { creates++; return { ...recipe, ...input, version: 3 }; },
    uploadMediaContent: async () => { binary++; return { checksumSha256: 'original-bytes' }; },
    confirmMediaAsset: async (id, checksum) => { confirmations.push([id, checksum]); if (++confirms === 1) throw new Error('confirmation response lost'); return { asset: { id: 'asset-a' }, ownerVersion: 4 }; },
    updateRecipe: async (id, input) => { writes.push(input); return { ...recipe, ...input, version: input.expectedVersion + 1 }; },
  });
  await show(''); fill(page); const selecting = page.chooseCover(); pickers[0].success({ tempFiles: [photo] }); await selecting;
  assert.equal(await page.persist(false), false); assert.match(page.coverError.value, /确认结果待核实/);
  page.name.value = '继续完善的菜名'; assert.equal(await page.persist(false), true);
  assert.equal(creates, 1); assert.equal(binary, 1); assert.equal(confirms, 2);
  assert.deepEqual(confirmations, [['intent-a', 'original-bytes'], ['intent-a', 'original-bytes']]);
  assert.equal(writes[0].expectedVersion, 4); assert.equal(writes[0].name, '继续完善的菜名'); assert.equal(page.recipeVersion.value, 5);
  assert.equal(page.pendingCover.value, undefined); assert.equal(page.coverAssetId.value, 'asset-a');
});

test('Cover confirmation retry never adopts an unrelated newer recipe version', async () => {
  let confirms = 0, textUpdates = 0;
  const { page, show, pickers, toasts } = form({
    confirmMediaAsset: async () => { if (++confirms === 1) throw new Error('response lost'); return { asset: { id: 'asset-a' }, ownerVersion: 3 }; },
    updateRecipe: async () => { textUpdates++; },
  });
  await show(''); fill(page); const selecting = page.chooseCover(); pickers[0].success({ tempFiles: [photo] }); await selecting;
  assert.equal(await page.persist(false), false); assert.equal(page.recipeVersion.value, 1);
  assert.equal(await page.persist(false), false); assert.equal(textUpdates, 0); assert.equal(page.recipeVersion.value, 1);
  assert.match(toasts.at(-1), /新改动/); assert.ok(page.pendingCover.value.confirmation); assert.equal(page.name.value, ' 新菜 ');
});

test('Staged cover save rechecks editing rights before binary and confirmation', async () => {
  for (const boundary of ['intent', 'binary']) {
    let allowed = true, binary = 0, confirmations = 0;
    const { page, show, pickers } = form({
      createMediaUploadIntent: async () => { if (boundary === 'intent') allowed = false; return { id: 'intent-a', uploadPath: '/upload' }; },
      uploadMediaContent: async () => { binary++; if (boundary === 'binary') allowed = false; return { checksumSha256: 'fake' }; },
      confirmMediaAsset: async () => { confirmations++; },
    }, async () => allowed ? context : { ...context, effectivePermissions: {} });
    await show(''); fill(page); const selecting = page.chooseCover(); pickers[0].success({ tempFiles: [photo] }); await selecting;
    assert.equal(await page.persist(true), false); assert.equal(binary, boundary === 'intent' ? 0 : 1); assert.equal(confirmations, 0);
    assert.equal(page.session.value, undefined); assert.equal(page.pendingCover.value, undefined); assert.equal(page.name.value, '');
  }
});

test('Leaving during staged cover save cannot confirm or restore the hidden draft', async () => {
  const transfer = deferred(); let started = false, confirmations = 0;
  const { page, show, pickers, life, routes, toasts } = form({ uploadMediaContent: () => { started = true; return transfer.promise; }, confirmMediaAsset: async () => { confirmations++; } });
  await show(''); fill(page); const selecting = page.chooseCover(); pickers[0].success({ tempFiles: [photo] }); await selecting;
  toasts.length = 0; const save = page.persist(true); await tick(); assert.equal(started, true);
  life.hide(); transfer.resolve({ checksumSha256: 'fake' }); assert.equal(await save, false);
  assert.equal(confirmations, 0); assert.equal(page.name.value, ''); assert.equal(page.pendingCover.value, undefined); assert.deepEqual(routes, []); assert.deepEqual(toasts, []);
});

test('Native cover selection cannot upload after switching household, revocation or unload', async () => {
  for (const ending of ['household', 'revoked', 'unload']) {
    let allowed = true, writes = 0;
    const { page, show, life, pickers, setStored } = form({ createMediaUploadIntent: async () => writes++ }, async () => allowed ? context : { ...context, effectivePermissions: {} });
    await show(); const pending = page.chooseCover(); life.hide();
    if (ending === 'household') setStored({ ...context, householdId: 'house-b' });
    if (ending === 'revoked') allowed = false;
    if (ending === 'unload') life.unload(); else await life.show();
    pickers[0].success({ tempFiles: [photo] }); await pending;
    assert.equal(writes, 0); assert.equal(page.name.value, ''); assert.equal(page.session.value, undefined); assert.equal(page.coverPreview.value, ''); assert.equal(page.coverUploading.value, false);
  }
});

test('Concurrent recipe change stops cover upload without adopting the new version or discarding draft text', async () => {
  let writes = 0; const { page, show, life, pickers, setRecipe, toasts } = form({ createMediaUploadIntent: async () => writes++ });
  await show(); page.name.value = '我的未保存改动'; const pending = page.chooseCover(); life.hide();
  setRecipe({ ...recipe, version: 4, name: '别人的改动' }); await life.show(); pickers[0].success({ tempFiles: [photo] }); await pending;
  assert.equal(writes, 0); assert.equal(page.name.value, '我的未保存改动'); assert.equal(page.recipeVersion.value, 3); assert.match(toasts.at(-1), /版本冲突/);
});

test('Malformed cover selections and mismatched file bytes make no recipe or upload-intent writes', async () => {
  const cases = [undefined, [], [photo, photo], [{ ...photo, tempFilePath: '' }], [{ ...photo, size: 0 }], [{ ...photo, size: -1 }], [{ ...photo, size: 4.5 }], [{ ...photo, size: 8 * 1024 * 1024 + 1 }], [{ ...photo, tempFilePath: '/tmp/photo.gif' }], [{ ...photo, size: 5 }]];
  for (const files of cases) {
    let writes = 0; const { page, show, pickers } = form({ createRecipe: async () => writes++, createMediaUploadIntent: async () => writes++ });
    await show(''); fill(page); const pending = page.chooseCover(); pickers[0].success({ tempFiles: files }); await pending;
    assert.equal(writes, 0); assert.equal(page.recipeId.value, ''); assert.equal(page.coverUploading.value, false); assert.equal(page.name.value, ' 新菜 ');
  }
});

test('Cover upload rechecks permission at intent, binary and confirmation boundaries', async () => {
  for (const boundary of ['intent', 'binary']) {
    let allowed = true, binary = 0, confirm = 0;
    const { page, show, pickers } = form({
      createMediaUploadIntent: async () => { if (boundary === 'intent') allowed = false; return { id: 'intent-a', uploadPath: '/upload' }; },
      uploadMediaContent: async () => { binary++; if (boundary === 'binary') allowed = false; return { checksumSha256: 'fake' }; },
      confirmMediaAsset: async () => { confirm++; },
    }, async () => allowed ? context : { ...context, effectivePermissions: {} });
    await show(); const pending = page.chooseCover(); pickers[0].success({ tempFiles: [photo] }); await pending;
    assert.equal(binary, boundary === 'intent' ? 0 : 1); assert.equal(confirm, 0); assert.equal(page.name.value, ''); assert.equal(page.session.value, undefined);
  }
});

test('Leaving during upload cannot confirm or refill private recipe fields when binary transfer finishes', async () => {
  const transferred = deferred(); let started = false, confirms = 0;
  const { page, show, life, pickers, toasts } = form({ uploadMediaContent: () => { started = true; return transferred.promise; }, confirmMediaAsset: async () => confirms++ });
  await show(); const pending = page.chooseCover(); pickers[0].success({ tempFiles: [photo] }); await tick(); assert.equal(started, true);
  life.hide(); transferred.resolve({ checksumSha256: 'fake' }); await pending;
  assert.equal(confirms, 0); assert.equal(page.name.value, ''); assert.equal(page.coverPreview.value, ''); assert.equal(toasts.length, 0); assert.equal(page.coverUploading.value, false);
});

test('Confirmed cover version survives a failed preview request so subsequent text save uses the new version', async () => {
  const writes = [];
  const { page, show, pickers } = form({ getMediaReadUrl: async () => { throw new Error('preview network error'); }, updateRecipe: async (id, input) => { writes.push(input); return { ...recipe, version: input.expectedVersion + 1 }; } });
  await show(); page.name.value = '草稿内容'; const pending = page.chooseCover(); pickers[0].success({ tempFiles: [photo] }); await pending;
  assert.equal(page.coverAssetId.value, 'asset-a'); assert.equal(page.recipeVersion.value, 4); assert.equal(page.coverPreview.value, ''); assert.match(page.coverError.value, /不会丢失/);
  await page.persist(false); assert.equal(writes[0].expectedVersion, 4); assert.equal(writes[0].name, '草稿内容');
});

test('Editor form controls are locked while saving or choosing a cover; plain saves still navigate back', async () => {
  const pending = deferred(); const { page, show, routes } = form({ updateRecipe: () => pending.promise });
  await show(); const saving = page.persist(true); page.addIngredient(); page.addStep(); page.removeIngredient(0); page.pickCategory({ detail: { value: '1' } });
  assert.equal(page.ingredients.value.length, 1); assert.equal(page.steps.value.length, 1); assert.equal(page.categoryIndex.value, 0);
  pending.resolve({ ...recipe, version: 4 }); await saving; assert.deepEqual(routes, ['back']);
});

test('Changing the loaded recipe invalidates a pending native picker without restoring its old draft', async () => {
  let writes = 0;
  const { page, show, pickers, setRecipe } = form({ createMediaUploadIntent: async () => writes++ });
  await show(); page.name.value = '旧菜草稿'; const pending = page.chooseCover();
  setRecipe({ ...recipe, id: 'recipe-b', name: '新菜详情' }); await show('recipe-b');
  pickers[0].success({ tempFiles: [photo] }); await pending;
  assert.equal(writes, 0); assert.equal(page.recipeId.value, 'recipe-b'); assert.equal(page.name.value, '新菜详情'); assert.equal(page.coverUploading.value, false);
});

test('Expired or delayed cover URLs cannot refill a hidden editor, and a fresh URL can be retried', async () => {
  const waiting = deferred(); let signed = 0;
  const { page, show, life } = form({ getRecipe: async () => ({ ...recipe, coverAssetId: 'asset-a' }), getMediaReadUrl: () => ++signed === 1 ? waiting.promise : Promise.resolve({ path: '/private/fresh' }) });
  const opening = show(); await tick(); life.hide(); waiting.resolve({ path: '/private/old' }); await opening;
  assert.equal(page.coverPreview.value, ''); assert.equal(page.coverAssetId.value, '');
  await life.show(); assert.equal(page.coverPreview.value, '/private/fresh');
  page.coverPreview.value = ''; await page.reloadCover(); assert.equal(page.coverPreview.value, '/private/fresh'); assert.equal(signed, 3);
});

test('Cover confirmation finishing after unload never reads a URL or repopulates the editor', async () => {
  const confirmation = deferred(); let started = false, reads = 0;
  const { page, show, pickers, life, toasts } = form({ confirmMediaAsset: () => { started = true; return confirmation.promise; }, getMediaReadUrl: async () => { reads++; return { path: '/private/asset' }; } });
  await show(); const pending = page.chooseCover(); pickers[0].success({ tempFiles: [photo] }); await tick(); assert.equal(started, true);
  life.unload(); confirmation.resolve({ asset: { id: 'asset-a' }, ownerVersion: 4 }); await pending;
  assert.equal(reads, 0); assert.equal(page.coverAssetId.value, ''); assert.equal(page.name.value, ''); assert.equal(toasts.length, 0);
});
