const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('vue/compiler-sfc');
const { renderToString } = require('vue/server-renderer');
const root = path.resolve(__dirname, '..');
class ApiError extends Error { constructor(message, statusCode) { super(message); this.statusCode = statusCode; } }
const context = { householdId: 'house-fixture', membershipId: 'member-fixture', effectivePermissions: { meals: 'MANAGE', recipes: 'MANAGE', inventory: 'VIEW', shopping: 'EDIT' } };
const recipe = { id: 'recipe-fixture', version: 1, name: '虚构菜谱', status: 'PUBLISHED', ingredients: [], seasonings: [], steps: ['步骤'] };
const initial = { id: 'meal-fixture', version: 1, status: 'DRAFT', localDate: '2026-10-23', mealType: 'DINNER', slotKey: '', snapshotVersion: 0,
  items: [{ recipeId: recipe.id, addedById: context.membershipId }], menu: [{ recipeId: recipe.id, recipe, cookMultiplier: '1', wantedBy: [{ membershipId: context.membershipId }] }] };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function evaluate(source, dependencies, uni) {
  const module = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, uni, Date, Error, Promise, Set,
    require(name) { assert.ok(name in dependencies, name); return dependencies[name]; } });
  return module.exports;
}
function fixture(overrides = {}) {
  const lifecycle = {}, toasts = [], uni = { showToast: input => toasts.push(input.title), showModal() {} };
  let stored = context, calendarTarget;
  const travel = evaluate(fs.readFileSync(path.join(root, 'src/services/trip-form.ts'), 'utf8'), {}, uni);
  const dependencies = { vue, '@dcloudio/uni-app': { onShow: fn => lifecycle.show = fn, onHide: fn => lifecycle.hide = fn, onUnload: fn => lifecycle.unload = fn },
    '../../services/transport': { ApiError }, '../../services/trip-form': travel, '../../services/calendar-navigation': { takeCalendarTarget() { const value = calendarTarget; calendarTarget = undefined; return value; } },
    '../../services/session': { getStoredSession: () => stored, refreshAccess: async () => stored,
      canAccess: (value, module, level = 'VIEW') => ({ VIEW: 1, EDIT: 2, MANAGE: 3 }[value?.effectivePermissions?.[module]] || 0) >= ({ VIEW: 1, EDIT: 2, MANAGE: 3 }[level]) },
    '../../services/family-api': { listRecipeCategories: async () => [], listRecipes: async () => [recipe], listMeals: async () => [initial], recalculateMeal: async () => [],
      mealTypeCodes: { 早餐: 'BREAKFAST', 午餐: 'LUNCH', 晚餐: 'DINNER', 加餐: 'OTHER' }, mealTypeLabel: value => value === 'DINNER' ? '晚餐' : value,
      ...overrides },
  };
  const filename = path.join(root, 'src/pages/meal/index.vue');
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename });
  const script = compileScript(descriptor, { id: 'meal-refresh', inlineTemplate: false });
  const page = evaluate(script.content, dependencies, uni).default.setup({}, { expose() {} });
  page.date.value = initial.localDate;
  const template = compileTemplate({ source: descriptor.template.content, filename, id: 'meal-refresh', compilerOptions: { bindingMetadata: script.bindings,
    isCustomElement: tag => ['view', 'text', 'image', 'input', 'button', 'picker', 'scroll-view'].includes(tag) } });
  assert.deepEqual(template.errors, []);
  const { render } = evaluate(template.code, { vue }, uni);
  async function rendered() {
    let tree;
    const html = await renderToString(vue.createSSRApp({ setup: () => () => { tree = render({}, [], {}, vue.proxyRefs(page)); return tree; } }));
    const buttons = [];
    const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.children) : typeof value === 'string' ? value : '';
    const visit = value => { if (Array.isArray(value)) return value.forEach(visit); if (!value || typeof value !== 'object') return;
      if (value.type === 'button') buttons.push({ label: text(value.children), disabled: Boolean(value.props?.disabled), tap: value.props?.onTap }); visit(value.children); };
    visit(tree); return { html, buttons };
  }
  return { page, lifecycle, toasts, rendered, setStored: value => stored = value, setTarget: value => calendarTarget = value };
}

test('Successful withdrawal followed by meal-read failure is explicit and disables inverse ordering until a successful refresh', async () => {
  let current = initial, reads = 0, withdrawals = 0, adds = 0, creates = 0, failReads = true;
  const f = fixture({ listMeals: async () => { if (++reads > 1 && failReads) throw new ApiError('餐点读取中断', 503); return [current]; },
    removeMealRecipe: async () => { withdrawals++; current = { ...initial, version: 2, items: [], menu: [] }; return { removed: true }; },
    addMealRecipe: async () => { adds++; }, createMeal: async () => { creates++; return current; } });
  await f.lifecycle.show(); await f.page.toggleRecipe(recipe.id);
  assert.equal(withdrawals, 1); assert.equal(f.page.meal.value, undefined);
  assert.match(f.page.errorText.value, /已保存.*刷新失败/);
  const rendered = await f.rendered(), button = rendered.buttons.find(value => value.label === '点这道菜');
  assert.ok(button); assert.equal(button.disabled, true);
  await f.page.toggleRecipe(recipe.id);
  assert.equal(adds, 0); assert.equal(creates, 0);
  failReads = false; await f.page.loadPage();
  assert.equal(f.page.meal.value.id, initial.id); assert.equal(f.page.ownRecipeIds.value.size, 0);
  assert.equal((await f.rendered()).buttons.find(value => value.label === '点这道菜').disabled, false);
});

test('Inventory comparison failure retains the authoritative meal and reports a saved withdrawal instead of pretending no meal exists', async () => {
  let current = initial, compares = 0, creates = 0;
  const f = fixture({ listMeals: async () => [current], recalculateMeal: async () => { if (++compares > 1) throw new ApiError('库存读取中断', 503); return []; },
    removeMealRecipe: async () => { current = { ...initial, version: 2, items: [], menu: [] }; return { removed: true }; }, createMeal: async () => { creates++; return current; } });
  await f.lifecycle.show(); await f.page.toggleRecipe(recipe.id);
  assert.equal(f.page.meal.value?.id, initial.id); assert.equal(f.page.meal.value.version, 2); assert.equal(f.page.ownRecipeIds.value.size, 0);
  assert.equal(f.page.comparison.value.length, 0); assert.equal(f.page.checkedShortages.value.length, 0);
  assert.ok(f.toasts.some(value => /已保存.*库存对照.*失败/.test(value)));
  const { html } = await f.rendered(); assert.match(html, /库存对照.*失败/); assert.doesNotMatch(html, /创建这顿餐点/);
  assert.equal(creates, 0);
});

test('Initial meal-read failure is not treated as an empty meal and cannot create or add a dish', async () => {
  let writes = 0;
  const f = fixture({ listMeals: async () => { throw new ApiError('餐点读取失败', 503); }, createMeal: async () => { writes++; return initial; }, addMealRecipe: async () => { writes++; } });
  await f.lifecycle.show(); await f.page.toggleRecipe(recipe.id); await f.page.beginOrdering();
  assert.equal(writes, 0);
  assert.equal((await f.rendered()).buttons.find(value => value.label === '点这道菜').disabled, true);
});

for (const status of [401, 403, 404]) test('Comparison ' + status + ' after a saved withdrawal invalidates the private meal instead of retaining stale choices', async () => {
  let reads = 0;
  const f = fixture({ recalculateMeal: async () => { if (++reads > 1) throw new ApiError('资源权限已变化', status); return []; }, removeMealRecipe: async () => ({ removed: true }) });
  await f.lifecycle.show(); await f.page.toggleRecipe(recipe.id);
  assert.equal(f.page.meal.value, undefined); assert.equal(f.page.comparison.value.length, 0);
  assert.equal(f.page.ownRecipeIds.value.size, 0);
  if (status !== 404) assert.equal(f.page.session.value, undefined);
});

test('A late failed refresh from a hidden page cannot contaminate the next account view', async () => {
  const pending = deferred(); let reads = 0;
  const f = fixture({ listMeals: async () => ++reads === 2 ? pending.promise : [initial], removeMealRecipe: async () => ({ removed: true }) });
  await f.lifecycle.show(); const withdrawal = f.page.toggleRecipe(recipe.id);
  await new Promise(setImmediate); f.lifecycle.hide();
  f.setStored({ ...context, householdId: 'next-house', membershipId: 'next-member' });
  await f.lifecycle.show();
  pending.reject(new ApiError('旧餐点刷新失败', 403)); await withdrawal;
  assert.equal(f.page.session.value.householdId, 'next-house');
  assert.doesNotMatch(f.page.errorText.value, /旧餐点/);
});

test('Write conflict preserves the current meal, choice and draft with no create/add retry', async () => {
  let withdraws = 0;
  const f = fixture({ removeMealRecipe: async () => { withdraws++; throw new ApiError('餐单版本冲突', 409); } });
  await f.lifecycle.show(); await f.page.toggleRecipe(recipe.id);
  assert.equal(withdraws, 1); assert.equal(f.page.meal.value.version, 1); assert.equal(f.page.ownRecipeIds.value.has(recipe.id), true);
  assert.match(f.page.errorText.value, /版本冲突/);
});

test('Calendar source-id normalization keeps the comparison current when the actual meal type differs from the initial selection', async () => {
  const stock = [{ key: 'fixture', status: 'SHORTAGE' }];
  const f = fixture({ listMeals: async () => [{ ...initial, mealType: 'BREAKFAST' }], recalculateMeal: async () => stock,
    mealTypeLabel: value => value === 'BREAKFAST' ? '早餐' : '晚餐' });
  f.setTarget({ date: initial.localDate, sourceId: initial.id });
  await f.lifecycle.show();
  assert.equal(f.page.mealType.value, '早餐');
  assert.equal(f.page.comparison.value[0].key, 'fixture');
  assert.deepEqual(Array.from(f.page.checkedShortages.value), ['fixture']);
});
