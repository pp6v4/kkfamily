const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('vue/compiler-sfc');
const ROOT = path.resolve(__dirname, '..');
class ApiError extends Error { constructor(message, statusCode) { super(message); this.statusCode = statusCode; } }
const context = { householdId: 'house-a', membershipId: 'member-a', effectivePermissions: { recipes: 'MANAGE', meals: 'MANAGE', inventory: 'VIEW', shopping: 'EDIT' } };
const recipe = { id: 'recipe-a', version: 3, name: '炒蛋', status: 'PUBLISHED', coverAssetId: null, category: null, ingredients: [], seasonings: [], steps: ['炒熟'] };
const meal = { id: 'meal-a', version: 4, localDate: '2026-09-01', scheduledAt: '2026-09-01T18:00:00+08:00', mealType: 'DINNER', slotKey: '', status: 'CONFIRMED', snapshotVersion: 2, legacyWithoutSnapshot: false, items: [], menu: [{ recipeId: recipe.id, recipe, cookMultiplier: '1', wantedBy: [] }] };
const shortage = { key: 'egg', kind: 'FOOD', status: 'SHORTAGE', name: '鸡蛋', required: '3', onHand: '1', shortage: '2', unit: '个' };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const tick = () => new Promise(setImmediate);
function evaluate(source, deps, uni) {
  const module = { exports: {} }, code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: id => { if (id in deps) return deps[id]; throw new Error('Unexpected import ' + id); }, uni, Date, Error, Promise, Set, console });
  return module.exports;
}
const travel = evaluate(fs.readFileSync(path.join(ROOT, 'src/services/trip-form.ts'), 'utf8'), {}, {});
function form(api = {}, access) {
  let stored = context, calendarTarget;
  const life = {}, toasts = [], modals = [], routes = [];
  const uni = { showToast: input => toasts.push(input.title), showModal: input => modals.push(input), navigateTo: input => routes.push(input.url) };
  const deps = {
    vue, '@dcloudio/uni-app': { onShow: fn => life.show = fn, onHide: fn => life.hide = fn, onUnload: fn => life.unload = fn },
    '../../services/session': { getStoredSession: () => stored, canAccess: (c, module, level = 'VIEW') => ({ VIEW: 1, EDIT: 2, MANAGE: 3 }[c?.effectivePermissions?.[module]] || 0) >= ({ VIEW: 1, EDIT: 2, MANAGE: 3 }[level]), refreshAccess: async () => access ? access() : stored },
    '../../services/transport': { ApiError }, '../../services/trip-form': travel,
    '../../services/calendar-navigation': { takeCalendarTarget: () => { const value = calendarTarget; calendarTarget = undefined; return value; } },
    '../../services/family-api': { listRecipeCategories: async () => [], listRecipes: async () => [recipe], listMeals: async () => [meal], recalculateMeal: async () => [shortage], listMealSnapshots: async () => [], publicMediaUrl: value => value,
      mealTypeCodes: { 早餐: 'BREAKFAST', 午餐: 'LUNCH', 晚餐: 'DINNER', 加餐: 'OTHER' }, mealTypeLabel: value => ({ BREAKFAST: '早餐', LUNCH: '午餐', DINNER: '晚餐', OTHER: '加餐' }[value]), ...api },
  };
  const filename = path.join(ROOT, 'src/pages/meal/index.vue'), { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename });
  const page = evaluate(compileScript(descriptor, { id: 'meal-test', inlineTemplate: false }).content, deps, uni).default.setup({}, { expose() {} });
  page.date.value = '2026-09-01';
  return { page, life, toasts, modals, routes, setStored: value => stored = value, setTarget: value => calendarTarget = value };
}

test('Meal page clears all private data and drafts on hide/unload and ignores pending reads', async () => {
  for (const end of ['hide', 'unload']) {
    const rows = deferred(); const { page, life } = form({ listRecipes: () => rows.promise });
    const pending = life.show(); await tick(); page.reopenReason.value = '私有原因'; page.categoryName.value = '私有分类';
    life[end](); rows.resolve([recipe]); await pending;
    assert.equal(page.recipes.value.length, 0); assert.equal(page.meal.value, undefined); assert.equal(page.comparison.value.length, 0); assert.equal(page.session.value, undefined); assert.equal(page.reopenReason.value, ''); assert.equal(page.categoryName.value, ''); assert.equal(page.loading.value, false);
  }
});
test('Meal page keeps the newest refresh when old lists complete later', async () => {
  const rows = deferred(); let count = 0;
  const { page, life } = form({ listRecipes: () => ++count === 1 ? rows.promise : Promise.resolve([{ ...recipe, id: 'new' }]) });
  const old = life.show(); await tick(); await life.show(); rows.resolve([recipe]); await old;
  assert.equal(page.recipes.value[0].id, 'new');
});
test('Meal selection can change while comparison is pending without old quantities filling the new meal', async () => {
  const wait = deferred(), breakfast = { ...meal, id: 'meal-b', mealType: 'BREAKFAST' }; let comparisons = 0;
  const { page, life } = form({ listMeals: async () => [meal, breakfast], recalculateMeal: () => ++comparisons === 1 ? Promise.resolve([shortage]) : comparisons === 2 ? wait.promise : Promise.resolve([{ ...shortage, key: 'new' }]) });
  await life.show(); const old = page.changeSelection('2026-09-01', '晚餐'); await tick(); const next = page.changeSelection('2026-09-01', '早餐');
  await next; wait.resolve([shortage]); await old;
  assert.equal(page.mealType.value, '早餐'); assert.equal(page.meal.value.id, 'meal-b'); assert.equal(page.comparison.value[0].key, 'new');
});
test('Denied meal and inventory modules do not send unauthorized reads or retain previous data', async () => {
  let lists = 0, stocks = 0;
  const { page, life } = form({ listMeals: async () => { lists++; return [meal]; }, recalculateMeal: async () => { stocks++; return [shortage]; } }, async () => ({ ...context, effectivePermissions: { recipes: 'VIEW' } }));
  await life.show(); assert.equal(lists, 0); assert.equal(stocks, 0); assert.equal(page.meal.value, undefined); assert.equal(page.recipes.value.length, 1);
});
test('Stale completion/transition modals expire after date, tab, household or meal version changes', async () => {
  for (const action of ['date', 'tab', 'identity', 'version', 'hide']) for (const operation of ['complete', 'cancel']) {
    let writes = 0; const { page, life, modals, setStored } = form({ completeMeal: async () => writes++, transitionMeal: async () => writes++ });
    await life.show(); if (operation === 'complete') page.finishCooking(); else page.confirmAction('cancel'); assert.equal(modals.length, 1);
    if (action === 'date') await page.changeSelection('2026-09-02', '晚餐');
    if (action === 'tab') page.active.value = 'recipes';
    if (action === 'identity') setStored({ ...context, householdId: 'house-b' });
    if (action === 'version') page.meal.value = { ...meal, version: 5 };
    if (action === 'hide') life.hide();
    await modals[0].success({ confirm: true }); assert.equal(writes, 0);
  }
});
test('Creating a meal then hiding never adds the pending recipe to an abandoned selection', async () => {
  const created = deferred(); let additions = 0;
  const { page, life } = form({ listMeals: async () => [], createMeal: () => created.promise, addMealRecipe: async () => additions++ });
  await life.show(); const pending = page.toggleRecipe(recipe.id); life.hide(); created.resolve({ ...meal, status: 'DRAFT' }); await pending;
  assert.equal(additions, 0); assert.equal(page.meal.value, undefined);
});
test('Duplicate completion confirmations issue one write and never send inventory consumption', async () => {
  const wait = deferred(), writes = [];
  const { page, life, modals } = form({ completeMeal: value => { writes.push(value); return wait.promise; } });
  await life.show(); page.finishCooking(); const first = modals[0].success({ confirm: true }); const second = modals[0].success({ confirm: true });
  const count = writes.length; wait.resolve({ ...meal, status: 'COMPLETED' }); await Promise.all([first, second]);
  assert.equal(count, 1); assert.equal(writes[0].id, meal.id); assert.equal(writes[0].version, 4); assert.equal(writes[0].consumptions, undefined);
});
test('Pending snapshot history cannot refill a different selection or hidden page', async () => {
  for (const change of ['select', 'hide']) {
    const wait = deferred(); const { page, life } = form({ listMealSnapshots: () => wait.promise });
    await life.show(); const pending = page.showHistory(); if (change === 'hide') life.hide(); else await page.changeSelection('2026-09-02', '早餐');
    wait.resolve([{ version: 1, data: { dishes: [] } }]); await pending; assert.equal(page.history.value.length, 0);
  }
});
test('Shortage import requires authorized inventory and shopping access and only current selected keys', async () => {
  let writes = 0; const { page, life } = form({ importMealShortages: async () => writes++ });
  await life.show(); page.checkedShortages.value = ['stale-key']; await page.confirmShopping(); assert.equal(writes, 0);
  page.checkedShortages.value = ['egg']; page.session.value = { ...context, effectivePermissions: { meals: 'VIEW', shopping: 'EDIT' } }; await page.confirmShopping(); assert.equal(writes, 0);
});
test('Typing a new extra-meal name does not silently change the loaded meal target', async () => {
  const extra = { ...meal, mealType: 'OTHER', slotKey: '下午茶' };
  const { page, life } = form({ listMeals: async () => [extra] });
  page.mealType.value = '加餐'; page.slotKey.value = '下午茶'; await life.show();
  assert.equal(page.meal.value.id, meal.id); page.slotInput.value = '宵夜';
  assert.equal(page.slotKey.value, '下午茶'); await page.changeSelection(page.date.value, '加餐'); assert.equal(page.slotKey.value, '宵夜'); assert.equal(page.meal.value, undefined);
});

test('An older page load cannot turn off the loading indicator of a newer meal query', async () => {
  const covers = deferred(), newest = deferred(); let lists = 0;
  const { page, life } = form({ listRecipes: async () => [{ ...recipe, coverAssetId: 'cover' }], getMediaReadUrl: () => covers.promise, listMeals: () => ++lists === 1 ? Promise.resolve([meal]) : newest.promise });
  const opening = life.show(); await tick(); const next = page.changeSelection('2026-09-02', '早餐');
  covers.resolve({ path: '/image' }); await opening; assert.equal(page.loading.value, true);
  newest.resolve([]); await next; assert.equal(page.loading.value, false); assert.equal(page.meal.value, undefined);
});

test('Late cover URLs and failures cannot refill or clear a newer authorized page', async () => {
  for (const fail of [false, true]) {
    const wait = deferred(); let calls = 0;
    const { page, life, toasts } = form({ listRecipes: async () => [{ ...recipe, coverAssetId: 'cover' }], getMediaReadUrl: () => ++calls === 1 ? wait.promise : Promise.resolve({ path: '/fresh' }) });
    const old = life.show(); await tick(); await life.show();
    if (fail) wait.reject(new ApiError('old denied', 403)); else wait.resolve({ path: '/old' }); await old;
    assert.equal(page.coverUrls.value[recipe.id], '/fresh'); assert.equal(page.recipes.value.length, 1); assert.equal(toasts.length, 0);
  }
});

test('Identity changes during refresh or meal reads clear private fields before further operations', async () => {
  for (const stage of ['access', 'meal']) {
    const wait = deferred(); let reads = 0;
    const { page, life, setStored } = form({ listMeals: () => { reads++; return stage === 'meal' ? wait.promise : Promise.resolve([meal]); } }, () => stage === 'access' ? wait.promise : Promise.resolve(context));
    const pending = life.show(); await tick(); setStored({ ...context, membershipId: 'member-b' }); wait.resolve(stage === 'access' ? context : [meal]); await pending;
    assert.equal(page.meal.value, undefined); assert.equal(page.session.value, undefined); assert.equal(page.recipes.value.length, 0); assert.equal(page.loading.value, false);
    if (stage === 'access') assert.equal(reads, 0);
  }
});

test('Authorized return reopens its prior extra meal by id, while a different household does not inherit it', async () => {
  const extra = { ...meal, mealType: 'OTHER', slotKey: '下午茶' };
  for (const same of [true, false]) {
    const { page, life, setStored } = form({ listMeals: async () => [extra] });
    page.mealType.value = '加餐'; page.slotKey.value = '下午茶'; await life.show(); life.hide(); assert.equal(page.slotKey.value, ''); assert.equal(page.slotInput.value, '');
    if (!same) setStored({ ...context, householdId: 'house-b', membershipId: 'member-b' });
    await life.show(); assert.equal(page.meal.value?.id, same ? meal.id : undefined); assert.equal(page.slotKey.value, same ? '下午茶' : '');
  }
});

test('Meal creation and own vote withdrawal use the intended day/slot without changing servings', async () => {
  let storedMeal, creations = [], added = [], removed = [];
  const { page, life } = form({ listMeals: async () => storedMeal ? [storedMeal] : [],
    createMeal: async input => { creations.push(input); storedMeal = { ...meal, status: 'DRAFT', snapshotVersion: 0, version: 1, menu: [], items: [] }; return storedMeal; },
    addMealRecipe: async (...args) => { added.push(args); storedMeal = { ...storedMeal, version: 2, items: [{ recipeId: recipe.id, addedById: context.membershipId }], menu: [{ recipeId: recipe.id, recipe, cookMultiplier: '1', wantedBy: [{ membershipId: context.membershipId }, { membershipId: 'spouse' }] }] }; },
    removeMealRecipe: async (...args) => { removed.push(args); storedMeal = { ...storedMeal, version: 3, items: [] }; },
  });
  await life.show(); await page.toggleRecipe(recipe.id); assert.equal(creations.length, 1); assert.equal(creations[0].scheduledAt, '2026-09-01T18:00:00+08:00'); assert.equal(creations[0].mealType, 'DINNER'); assert.equal(creations[0].slotKey, undefined);
  assert.deepEqual(added, [[meal.id, recipe.id]]); assert.equal(page.mealItems.value[0].cookMultiplier, '1'); assert.equal(page.mealItems.value[0].wantedBy.length, 2);
  await page.toggleRecipe(recipe.id); assert.equal(creations.length, 1); assert.deepEqual(removed, [[meal.id, recipe.id]]); assert.equal(page.ownRecipeIds.value.has(recipe.id), false);
});

test('Servings reject invalid numbers and preserve exact captured meal version on a valid update', async () => {
  const writes = []; let storedMeal = { ...meal, status: 'DRAFT' };
  const { page, life } = form({ listMeals: async () => [storedMeal], updateMealDish: async (value, id, quantity) => { writes.push({ value, id, quantity }); storedMeal = { ...storedMeal, version: 5, menu: [{ ...storedMeal.menu[0], cookMultiplier: String(quantity) }] }; return storedMeal; } });
  await life.show();
  for (const text of ['', ' ', '0', '-1', '100.001', '1.0001', '0x10', '1e1']) { page.servings.value[recipe.id] = text; await page.saveServings(recipe.id); }
  assert.equal(writes.length, 0); page.servings.value[recipe.id] = '1.125'; await page.saveServings(recipe.id);
  assert.equal(writes[0].value.version, 4); assert.equal(writes[0].id, recipe.id); assert.equal(writes[0].quantity, 1.125); assert.equal(page.meal.value.version, 5); assert.equal(page.servings.value[recipe.id], '1.125');
});

test('Meal workflow reloads actual returned state and shortage import preserves snapshot/key values', async () => {
  let storedMeal = { ...meal, status: 'DRAFT', snapshotVersion: 0 }; const transitions = [], imports = [];
  const { page, life, modals } = form({ listMeals: async () => [storedMeal],
    transitionMeal: async (value, action, reason) => { transitions.push({ version: value.version, action, reason }); storedMeal = { ...storedMeal, version: storedMeal.version + 1, status: action === 'confirm' ? 'CONFIRMED' : 'COOKING', snapshotVersion: 1 }; return storedMeal; },
    importMealShortages: async (value, keys) => imports.push({ value, keys }),
    completeMeal: async () => { storedMeal = { ...storedMeal, version: storedMeal.version + 1, status: 'COMPLETED' }; return storedMeal; },
  });
  await life.show(); page.confirmAction('confirm'); await modals.at(-1).success({ confirm: true }); assert.equal(page.meal.value.status, 'CONFIRMED');
  await page.confirmShopping(); assert.equal(imports[0].value.snapshotVersion, 1); assert.equal(imports[0].value.version, 5); assert.deepEqual(Array.from(imports[0].keys), ['egg']);
  page.confirmAction('start'); await modals.at(-1).success({ confirm: true }); assert.equal(page.meal.value.status, 'COOKING');
  page.finishCooking(); await modals.at(-1).success({ confirm: true }); assert.equal(page.meal.value.status, 'COMPLETED'); assert.deepEqual(transitions.map(value => [value.action, value.version]), [['confirm', 4], ['start', 5]]);
});

test('Write failures release the lock; permission errors clear private state, conflicts keep the captured meal', async () => {
  for (const code of [401, 403, 409]) {
    const { page, life } = form({ importMealShortages: async () => { throw new ApiError('failure-' + code, code); } });
    await life.show(); await page.confirmShopping(); assert.equal(page.writing.value, false); assert.equal(page.errorText.value, 'failure-' + code);
    if (code === 409) assert.equal(page.meal.value.version, 4); else { assert.equal(page.meal.value, undefined); assert.equal(page.recipes.value.length, 0); assert.equal(page.session.value, undefined); }
  }
});

test('Late category writes and stale archive/status modals do not alter another view', async () => {
  const group = { id: 'group', version: 2, name: '海鲜', sortOrder: 0 };
  for (const kind of ['category', 'recipe']) {
    let writes = 0; const { page, life, modals } = form({ listRecipeCategories: async () => [group], archiveRecipeCategory: async () => writes++, updateRecipeStatus: async () => writes++ });
    await life.show(); page.switchView('recipes');
    if (kind === 'category') page.confirmCategoryArchive(group); else page.changeRecipeStatus(recipe, 'ARCHIVED');
    page.switchView('menu'); page.switchView('recipes'); await modals[0].success({ confirm: true }); assert.equal(writes, 0);
  }
  const saved = deferred(); const { page, life, toasts } = form({ createRecipeCategory: () => saved.promise });
  await life.show(); page.categoryName.value = '新分类'; const writing = page.saveCategory(); life.hide(); saved.resolve(group); await writing;
  assert.equal(page.recipeCategories.value.length, 0); assert.equal(page.categoryName.value, ''); assert.equal(toasts.length, 0); assert.equal(page.writing.value, false);
});

test('Edited extra-meal text blocks mutations and invalidates an older confirmation until selected', async () => {
  const extra = { ...meal, mealType: 'OTHER', slotKey: '下午茶' }; let writes = 0;
  const { page, life, modals } = form({ listMeals: async () => [extra], completeMeal: async () => writes++, importMealShortages: async () => writes++ });
  page.mealType.value = '加餐'; page.slotKey.value = '下午茶'; await life.show(); page.finishCooking(); page.slotInput.value = '宵夜';
  await modals[0].success({ confirm: true }); await page.confirmShopping(); assert.equal(writes, 0); assert.equal(page.meal.value.slotKey, '下午茶');
});

test('Confirmation callbacks recheck current management permission after the dialog opens', async () => {
  for (const kind of ['complete', 'cancel']) {
    let writes = 0; const { page, life, modals } = form({ completeMeal: async () => writes++, transitionMeal: async () => writes++ });
    await life.show(); if (kind === 'complete') page.finishCooking(); else page.confirmAction('cancel');
    page.session.value = { ...context, effectivePermissions: { meals: 'VIEW' } }; await modals[0].success({ confirm: true }); assert.equal(writes, 0);
  }
});

test('Latest history response wins and reopening uses the reason captured when confirmed', async () => {
  const old = deferred(); let reads = 0, sent;
  const { page, life, modals } = form({ listMealSnapshots: () => ++reads === 1 ? old.promise : Promise.resolve([{ version: 2 }]), transitionMeal: async (value, action, reason) => { sent = { value, action, reason }; return { ...meal, status: 'DRAFT' }; } });
  await life.show(); const pending = page.showHistory(); await page.showHistory(); old.resolve([{ version: 1 }]); await pending; assert.equal(page.history.value[0].version, 2);
  page.reopenReason.value = '  家人想换道菜  '; page.confirmAction('reopen'); page.reopenReason.value = '后来输入'; await modals[0].success({ confirm: true });
  assert.equal(sent.value.version, 4); assert.equal(sent.action, 'reopen'); assert.equal(sent.reason, '家人想换道菜');
});
