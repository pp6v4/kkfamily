const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('vue/compiler-sfc');
class ApiError extends Error { constructor(message, statusCode) { super(message); this.statusCode = statusCode; } }
const context = { householdId: 'house-a', membershipId: 'member-a', householdName: '测试家庭', accessToken: 'test-token', roles: [], effectivePermissions: { recipes: 'EDIT' } };
const recipe = { id: 'recipe-a', version: 3, name: '番茄炒蛋', status: 'DRAFT', coverAssetId: null, category: null, ingredients: [{ ingredient: { id: 'i', name: '鸡蛋' }, quantity: '2', unit: '个' }], seasonings: [{ name: '盐' }], steps: ['炒熟'] };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const tick = () => new Promise(setImmediate);
function form(api = {}, access) {
  const life = {}, toasts = [], routes = [], pickers = [];
  let stored = context, liveRecipe = { ...recipe };
  const uni = { showToast: input => toasts.push(input.title), setNavigationBarTitle() {}, navigateBack: () => routes.push('back'), chooseMedia: input => pickers.push(input), getFileSystemManager: () => ({ readFile: input => input.success({ data: new ArrayBuffer(4) }) }) };
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
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: id => { if (id in deps) return deps[id]; throw new Error('Unexpected import ' + id); }, uni, Date, Error, Promise, setTimeout, clearTimeout });
  const page = module.exports.default.setup({}, { expose() {} });
  async function show(id = recipe.id) { const loaded = life.load({ id }); return life.show ? life.show() : loaded; }
  return { page, life, show, toasts, routes, pickers, uni, setStored: value => stored = value, setRecipe: value => liveRecipe = value };
}
function fill(page) { page.name.value = ' 新菜 '; page.ingredients.value = [{ name: ' 鸡蛋 ', quantity: '2.125', unit: ' 个 ' }]; page.seasonings.value = [' 盐 ', '']; page.steps.value = [' 炒熟 ']; }

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

test('New recipe cover creates exactly one draft before upload and reuses it after upload failure', async () => {
  let creates = 0, uploads = 0; const intents = [];
  const { page, show, pickers } = form({ createRecipe: async input => { creates++; return { ...recipe, ...input, version: 3 }; }, createMediaUploadIntent: async input => { intents.push(input); return { id: 'intent-a', uploadPath: '/upload' }; }, uploadMediaContent: async () => { if (++uploads === 1) throw new Error('network'); return { checksumSha256: 'fake' }; } });
  await show(''); fill(page);
  const first = page.chooseCover(); pickers[0].success({ tempFiles: [photo] }); await first;
  assert.equal(creates, 1); assert.equal(page.recipeId.value, recipe.id); assert.equal(page.recipeVersion.value, 3); assert.equal(page.coverUploading.value, false);
  const second = page.chooseCover(); pickers[1].success({ tempFiles: [photo] }); await second;
  assert.equal(creates, 1); assert.equal(intents.length, 2); assert.equal(page.coverAssetId.value, 'asset-a'); assert.equal(page.recipeVersion.value, 4);
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
