const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('vue/compiler-sfc');
const filename = path.resolve(__dirname, '../src/pages/recipe-editor/index.vue');
const context = { householdId: 'draft-house', membershipId: 'draft-member', effectivePermissions: { recipes: 'EDIT' } };
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
class ApiError extends Error { constructor(message, statusCode) { super(message); this.statusCode = statusCode; } }
const tick = () => new Promise(setImmediate);
function deferred() { let resolve; const promise = new Promise(yes => resolve = yes); return { promise, resolve }; }
function environment() {
  return { storage: new Map(), files: new Map(), recipes: new Map(), writes: [], categories: [
    { id: 'cat-a', name: '炒菜', version: 1, sortOrder: 0 },
    { id: 'cat-b', name: '海鲜', version: 1, sortOrder: 1 },
  ] };
}
function form(env = environment(), options = {}) {
  const life = {}, modals = [], toasts = [], pickers = [], routes = [];
  let identity = clone(options.identity || context), denied = false;
  const uni = {
    getStorageSync: key => clone(env.storage.get(key)),
    setStorageSync: (key, value) => { if (options.storageFailure) throw Error('storage full'); env.storage.set(key, clone(value)); },
    removeStorageSync: key => env.storage.delete(key),
    showModal: input => modals.push(input), showToast: input => toasts.push(input.title),
    setNavigationBarTitle() {}, navigateBack: () => routes.push('back'), chooseMedia: input => pickers.push(input),
    getFileSystemManager: () => ({
      readFile: input => env.files.has(input.filePath) ? input.success({ data: env.files.get(input.filePath) }) : input.fail({ errMsg: 'file missing' }),
      saveFile: input => { if (options.saveFile) return options.saveFile(input); if (options.imageBackupFailure) { input.fail({ errMsg: 'quota exceeded' }); return; } const savedFilePath = '/saved/recipe-' + env.files.size + '.jpg'; env.files.set(savedFilePath, env.files.get(input.tempFilePath)); input.success({ savedFilePath }); },
      removeSavedFile: input => { assert.match(input.filePath, /^\/saved\//); env.files.delete(input.filePath); },
    }),
  };
  const toRecipe = (id, input, version) => ({ id, version, name: input.name, status: 'DRAFT', coverAssetId: null,
    category: env.categories.find(item => item.id === input.categoryId) || null,
    ingredients: input.ingredients.map(item => ({ ingredient: { name: item.name }, quantity: item.quantity ?? null, unit: item.unit })),
    seasonings: input.seasonings.map(name => ({ name })), steps: input.steps });
  const api = {
    listRecipeCategories: async () => clone(env.categories),
    getRecipe: async id => { if (!env.recipes.has(id)) throw new ApiError('菜谱不存在', 404); return clone(env.recipes.get(id)); },
    createRecipe: async input => { env.writes.push(['create', clone(input)]); const saved = toRecipe('saved-' + env.recipes.size, input, 1); env.recipes.set(saved.id, saved); return clone(saved); },
    updateRecipe: async (id, input) => { env.writes.push(['update', id, clone(input)]); const existing = env.recipes.get(id); if (existing.version !== input.expectedVersion) throw new ApiError('菜谱已更新', 409); const saved = toRecipe(id, input, existing.version + 1); env.recipes.set(id, saved); return clone(saved); },
    publicMediaUrl: value => value, getMediaReadUrl: async () => ({ path: '/signed-not-for-cache' }),
    createMediaUploadIntent: async () => ({ id: 'intent', uploadPath: '/upload' }),
    uploadMediaContent: async () => { throw Error('upload unavailable'); },
    ...options.api,
  };
  function evaluate(source) {
    const module = { exports: {} };
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, uni, Date, Error, Promise, setTimeout, clearTimeout, console, require: id => {
      if (id === 'vue') return vue;
      if (id === '@dcloudio/uni-app') return { onLoad: fn => life.load = fn, onShow: fn => life.show = fn, onHide: fn => life.hide = fn, onUnload: fn => life.unload = fn };
      if (id === '../../services/family-api') return api;
      if (id === '../../services/transport') return { ApiError };
      if (id === '../../services/session') return { getStoredSession: () => identity, canAccess: c => c?.effectivePermissions?.recipes === 'EDIT', refreshAccess: async () => { if (denied) throw new ApiError('无权访问', 403); return identity; } };
      if (id === '../../services/recipe-draft') return evaluate(fs.readFileSync(path.resolve(__dirname, '../src/services/recipe-draft.ts'), 'utf8'));
      throw Error('Unexpected dependency ' + id);
    } });
    return module.exports;
  }
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename });
  const page = evaluate(compileScript(descriptor, { id: 'draft-recovery', inlineTemplate: false }).content).default.setup({}, { expose() {} });
  return { page, life, modals, toasts, pickers, routes, env,
    open: async (id = '') => { life.load({ id }); await life.show(); },
    setIdentity: value => identity = value, deny: () => denied = true,
  };
}
function fill(page) {
  page.name.value = '未完成的虾仁炒蛋'; page.pickCategory({ detail: { value: '2' } });
  page.ingredients.value = [{ name: '虾仁', quantity: '1.250', unit: '斤' }, { name: '鸡蛋', quantity: '', unit: '个' }];
  page.seasonings.value = ['盐', '生抽']; page.steps.value = ['虾仁洗净', ''];
}
function fields(page) { return { name: page.name.value, category: page.categoryOptions.value[page.categoryIndex.value]?.id,
  ingredients: clone(page.ingredients.value), seasonings: clone(page.seasonings.value), steps: clone(page.steps.value) }; }
async function resume(f) { assert.ok(f.modals.length, 'A fresh editor must offer recovery'); f.modals.at(-1).success({ confirm: true, cancel: false }); await tick(); }

test('A saved cover alone is not an unsaved draft, while unsaved text remains recoverable with the new cover version', async () => {
  for (const edited of [false, true]) {
    const env = environment(), initial = form(env); await initial.open(); fill(initial.page); await initial.page.persist(false);
    env.files.set('/temp/cover.jpg', new ArrayBuffer(4));
    const f = form(env, { api: {
      uploadMediaContent: async () => ({ checksumSha256: 'checksum' }),
      confirmMediaAsset: async () => { const recipe = env.recipes.get('saved-0'); recipe.version++; recipe.coverAssetId = 'new-cover'; return { ownerVersion: recipe.version, asset: { id: 'new-cover' } }; },
    } }); await f.open('saved-0');
    if (edited) f.page.name.value = '改过还没保存的菜名';
    const selecting = f.page.chooseCover(); f.pickers[0].success({ tempFiles: [{ tempFilePath: '/temp/cover.jpg', size: 4 }] }); await selecting;
    assert.equal(f.page.recipeVersion.value, 2);
    assert.equal(env.storage.size, edited ? 1 : 0);
    if (edited) { const draft = [...env.storage.values()][0].fields; assert.equal(draft.name, '改过还没保存的菜名'); assert.equal(draft.version, 2); assert.equal(draft.coverAssetId, 'new-cover'); }
    f.life.hide(); const next = form(env); await next.open('saved-0'); assert.equal(next.modals.length, edited ? 1 : 0);
  }
});

test('A local image backup finishing after unload releases its orphan without overwriting the retained text draft', async () => {
  const env = environment(); env.files.set('/temp/cover.jpg', new ArrayBuffer(4)); let savingFile;
  const f = form(env, { saveFile: input => { savingFile = input; } }); await f.open(); fill(f.page);
  const selecting = f.page.chooseCover(); f.pickers[0].success({ tempFiles: [{ tempFilePath: '/temp/cover.jpg', size: 4 }] }); await tick();
  assert.ok(savingFile); f.life.unload();
  env.files.set('/saved/late.jpg', new ArrayBuffer(4)); savingFile.success({ savedFilePath: '/saved/late.jpg' }); await selecting;
  assert.equal(env.files.has('/saved/late.jpg'), false);
  assert.equal([...env.storage.values()][0].fields.name, '未完成的虾仁炒蛋');
  assert.equal([...env.storage.values()][0].fields.pendingCover, undefined);
});

test('Typing persists incomplete recipe fields immediately, without waiting for hide or submitting', async () => {
  const f = form(); await f.open(); fill(f.page);
  assert.equal(f.env.storage.size, 1); assert.equal(f.env.writes.length, 0);
  const record = [...f.env.storage.values()][0]; assert.equal(record.fields.name, '未完成的虾仁炒蛋');
  assert.equal(record.fields.categoryId, 'cat-b'); assert.equal(record.fields.ingredients[0].quantity, '1.250');
  assert.deepEqual(record.fields.steps, ['虾仁洗净', '']);
  assert.doesNotMatch(JSON.stringify(record), /accessToken|signed-not-for-cache/);
});

test('Ordinary background return restores the same draft after authorization, including category identity after reorder', async () => {
  const f = form(); await f.open(); fill(f.page); const before = fields(f.page);
  f.life.hide(); assert.equal(f.page.name.value, '');
  f.env.categories.reverse(); await f.life.show();
  assert.deepEqual(fields(f.page), before); assert.equal(f.modals.length, 0); assert.equal(f.env.writes.length, 0);
});

test('Restart without lifecycle callbacks offers recovery; postponing keeps it, and confirm restores exact unfinished input', async () => {
  const env = environment(), first = form(env); await first.open(); fill(first.page); const before = fields(first.page);
  const restarted = form(env); await restarted.open();
  assert.equal(restarted.page.name.value, ''); assert.equal(restarted.modals.length, 1);
  restarted.modals[0].success({ confirm: false, cancel: true }); await tick(); assert.equal(env.storage.size, 1);
  await restarted.page.continueLocalDraft(); assert.deepEqual(fields(restarted.page), before); assert.equal(env.writes.length, 0);
});

test('Successful explicit save removes its recovery record; validation and network failures retain it', async () => {
  const env = environment(), f = form(env); await f.open(); f.page.name.value = '半道菜';
  assert.equal(await f.page.persist(false), false); assert.equal(env.storage.size, 1);
  fill(f.page); assert.equal(await f.page.persist(false), true); assert.equal(env.storage.size, 0);
  const next = form(env); await next.open(); assert.equal(next.modals.length, 0); assert.equal(next.page.name.value, '');
  const failed = form(env, { api: { createRecipe: async () => { throw Error('offline'); } } }); await failed.open(); fill(failed.page);
  assert.equal(await failed.page.persist(false), false); assert.equal(env.storage.size, 1); assert.equal(failed.page.name.value, '未完成的虾仁炒蛋');
});

test('Different accounts and households never see another draft; revoked access cannot restore its content', async () => {
  const env = environment(), first = form(env); await first.open(); fill(first.page);
  for (const identity of [{ ...context, membershipId: 'other' }, { ...context, householdId: 'other' }]) {
    const other = form(env, { identity }); await other.open(); assert.equal(other.modals.length, 0); assert.equal(other.page.name.value, '');
  }
  const revoked = form(env); revoked.deny(); await revoked.open(); assert.equal(revoked.modals.length, 0); assert.equal(revoked.page.name.value, '');
});

test('Draft discard requires its own confirmation and a cancelled discard preserves all fields', async () => {
  const env = environment(), first = form(env); await first.open(); fill(first.page);
  const next = form(env); await next.open(); next.modals[0].success({ cancel: true });
  next.page.discardLocalDraft(); next.modals.at(-1).success({ cancel: true }); await tick(); assert.equal(env.storage.size, 1);
  next.page.discardLocalDraft(); next.modals.at(-1).success({ confirm: true }); await tick(); assert.equal(env.storage.size, 0);
  assert.equal(next.page.name.value, ''); assert.equal(env.writes.length, 0);
});

test('Storage failure is visible and backgrounding still preserves the in-memory draft', async () => {
  const f = form(environment(), { storageFailure: true }); await f.open(); fill(f.page); const before = fields(f.page);
  assert.match(f.page.draftCacheError.value, /草稿|备份/); f.life.hide(); await f.life.show();
  assert.deepEqual(fields(f.page), before); assert.equal(f.env.writes.length, 0);
});

test('Late recovery confirmation cannot expose a draft after identity changes', async () => {
  const env = environment(), first = form(env); await first.open(); fill(first.page);
  const next = form(env); await next.open(); next.setIdentity({ ...context, membershipId: 'other' });
  next.modals[0].success({ confirm: true }); await tick(); assert.equal(next.page.name.value, ''); assert.equal(env.writes.length, 0);
});

test('Selected new-recipe image survives restart via a saved local file; failed upload resumes the existing server recipe', async () => {
  const env = environment(); env.files.set('/temp/cover.jpg', new ArrayBuffer(4));
  const first = form(env); await first.open(); fill(first.page);
  const selecting = first.page.chooseCover(); first.pickers[0].success({ tempFiles: [{ tempFilePath: '/temp/cover.jpg', size: 4 }] }); await selecting;
  const savedPath = first.page.pendingCover.value.tempFilePath; assert.match(savedPath, /^\/saved\//); env.files.delete('/temp/cover.jpg');
  const second = form(env); await second.open(); await resume(second); assert.equal(second.page.pendingCover.value.tempFilePath, savedPath);
  assert.equal(await second.page.persist(false), false); assert.equal(env.writes.filter(item => item[0] === 'create').length, 1);
  const third = form(env); await third.open(); await resume(third); assert.equal(third.page.recipeId.value, 'saved-0');
  await third.page.persist(false); assert.equal(env.writes.filter(item => item[0] === 'create').length, 1); assert.equal(env.writes.at(-1)[0], 'update');
});

test('Saving then hiding cannot let a late reply refill the page or erase a newer recovery draft', async () => {
  const env = environment(), pending = deferred();
  const f = form(env, { api: { createRecipe: () => pending.promise } }); await f.open(); fill(f.page);
  const saving = f.page.persist(true); f.life.hide();
  const newer = form(env); await newer.open(); await resume(newer); newer.page.name.value = '后来的新内容';
  pending.resolve({ id: 'late', version: 1, status: 'DRAFT' }); await saving;
  assert.equal(f.page.name.value, ''); assert.deepEqual(f.routes, []);
  assert.equal([...env.storage.values()][0].fields.name, '后来的新内容');
});

test('Unloading preserves a recoverable draft, and a failed category refresh does not erase it', async () => {
  const env = environment(), first = form(env); await first.open(); fill(first.page); const before = fields(first.page);
  first.life.unload(); assert.equal(first.page.name.value, ''); assert.equal(env.storage.size, 1);
  const unavailable = form(env, { api: { listRecipeCategories: async () => { throw Error('offline'); } } }); await unavailable.open();
  assert.equal(env.storage.size, 1); assert.equal(unavailable.page.name.value, '');
  const next = form(env); await next.open(); await resume(next); assert.deepEqual(fields(next.page), before);
});

test('A removed draft category is retained across restarts until the user explicitly picks a replacement', async () => {
  const env = environment(), first = form(env); await first.open(); fill(first.page);
  env.categories = env.categories.filter(item => item.id !== 'cat-b');
  const next = form(env); await next.open(); await resume(next);
  assert.equal(next.page.categoryNeedsReview.value, true); assert.equal(await next.page.persist(false), false); assert.equal(env.writes.length, 0);
  assert.equal([...env.storage.values()][0].fields.categoryId, 'cat-b');
  const last = form(env); await last.open(); await resume(last); assert.equal(last.page.categoryNeedsReview.value, true);
  last.page.pickCategory({ detail: { value: '1' } }); assert.equal(await last.page.persist(false), true); assert.equal(env.writes[0][1].categoryId, 'cat-a');
});

test('An edited recipe recovery preserves its original version and cannot overwrite a later server edit', async () => {
  const env = environment(), create = form(env); await create.open(); fill(create.page); await create.page.persist(false);
  const edit = form(env); await edit.open('saved-0'); edit.page.name.value = '本机未保存修改';
  const latest = { ...env.recipes.get('saved-0'), name: '家人已保存修改', version: 2 }; env.recipes.set('saved-0', latest);
  const reopened = form(env); await reopened.open('saved-0'); await resume(reopened);
  assert.equal(reopened.page.name.value, '本机未保存修改'); assert.equal(reopened.page.recipeVersion.value, 1);
  assert.equal(await reopened.page.persist(false), false); assert.equal(env.recipes.get('saved-0').name, '家人已保存修改');
  assert.equal([...env.storage.values()][0].fields.name, '本机未保存修改');
});

test('An expired local picture reports reselection while all typed recipe fields remain recovered', async () => {
  const env = environment(); env.files.set('/temp/cover.jpg', new ArrayBuffer(4));
  const first = form(env); await first.open(); fill(first.page); const before = fields(first.page);
  const selecting = first.page.chooseCover(); first.pickers[0].success({ tempFiles: [{ tempFilePath: '/temp/cover.jpg', size: 4 }] }); await selecting;
  env.files.clear(); const next = form(env); await next.open(); await resume(next);
  assert.deepEqual(fields(next.page), before); assert.match(next.page.coverError.value, /重新选择/); assert.equal(next.page.pendingCover.value, undefined);
});

test('An image backup failure stays visible after the text checkpoint succeeds', async () => {
  const env = environment(); env.files.set('/temp/cover.jpg', new ArrayBuffer(4));
  const f = form(env, { imageBackupFailure: true }); await f.open(); fill(f.page);
  const selecting = f.page.chooseCover(); f.pickers[0].success({ tempFiles: [{ tempFilePath: '/temp/cover.jpg', size: 4 }] }); await selecting;
  assert.equal(env.storage.size, 1); assert.match(f.page.coverBackupError.value, /图片.*备份/); assert.equal(f.page.name.value, '未完成的虾仁炒蛋');
});

test('Replacing or explicitly discarding a draft cover releases only its saved local copy', async () => {
  const env = environment(); env.files.set('/temp/first.jpg', new ArrayBuffer(4)); env.files.set('/temp/second.jpg', new ArrayBuffer(4));
  const f = form(env); await f.open(); fill(f.page);
  const first = f.page.chooseCover(); f.pickers[0].success({ tempFiles: [{ tempFilePath: '/temp/first.jpg', size: 4 }] }); await first;
  const oldPath = f.page.pendingCover.value.tempFilePath;
  const second = f.page.chooseCover(); f.pickers[1].success({ tempFiles: [{ tempFilePath: '/temp/second.jpg', size: 4 }] }); await second;
  const currentPath = f.page.pendingCover.value.tempFilePath; assert.notEqual(oldPath, currentPath); assert.equal(env.files.has(oldPath), false);
  const next = form(env); await next.open(); next.page.discardLocalDraft(); next.modals.at(-1).success({ confirm: true }); await tick();
  assert.equal(env.files.has(currentPath), false); assert.equal(env.files.has('/temp/first.jpg'), true); assert.equal(env.files.has('/temp/second.jpg'), true);
});
