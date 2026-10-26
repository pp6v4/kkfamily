const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('vue/compiler-sfc');
const { renderToString } = require('vue/server-renderer');
const ROOT = path.resolve(__dirname, '..');
const filename = path.join(ROOT, 'src/pages/meal/index.vue');
const context = { householdId: 'house-a', membershipId: 'member-a', effectivePermissions: { recipes: 'MANAGE', meals: 'MANAGE', inventory: 'VIEW', shopping: 'EDIT' } };
const groups = [{ id: 'cat-main', name: '主食', sortOrder: 0, version: 5 }, { id: 'cat-soup', name: '汤羹', sortOrder: 1, version: 3 }];
const recipe = (id, name, category, status = 'PUBLISHED') => ({ id, name, category, status, version: 4, ingredients: [], seasonings: [], steps: ['做好装盘'] });
const rows = [recipe('rice', '蛋炒饭', groups[0]), recipe('soup', '番茄汤', groups[1]), recipe('draft', '草稿粥', groups[0], 'DRAFT'), recipe('plain', '水果拼盘', null)];
function evaluate(source, deps, uni) {
  const module = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: id => { if (id in deps) return deps[id]; throw new Error('Unexpected import ' + id); }, uni, Date, Error, Promise, Set, Map, console });
  return module.exports;
}
const travel = evaluate(fs.readFileSync(path.join(ROOT, 'src/services/trip-form.ts'), 'utf8'), {}, {});
function form(api = {}, identity = context) {
  const life = {}, modals = [], writes = [];
  const uni = { showToast() {}, showModal: input => modals.push(input), navigateTo() {} };
  const deps = {
    vue, '@dcloudio/uni-app': { onShow: fn => life.show = fn, onHide: fn => life.hide = fn, onUnload: fn => life.unload = fn },
    '../../services/session': { getStoredSession: () => identity, canAccess: (c, module, level = 'VIEW') => ({ VIEW: 1, EDIT: 2, MANAGE: 3 }[c?.effectivePermissions?.[module]] || 0) >= ({ VIEW: 1, EDIT: 2, MANAGE: 3 }[level]), refreshAccess: async () => identity },
    '../../services/transport': { ApiError: class ApiError extends Error {} }, '../../services/trip-form': travel,
    '../../services/calendar-navigation': { takeCalendarTarget: () => undefined },
    '../../services/family-api': {
      listRecipeCategories: async () => structuredClone(groups), listRecipes: async () => structuredClone(rows), listMeals: async () => [], recalculateMeal: async () => [], publicMediaUrl: value => value,
      updateRecipeCategory: async (category, input) => { writes.push({ category, input }); return { ...category, ...input, version: category.version + 1 }; },
      archiveRecipeCategory: async category => { writes.push({ archive: category }); return { ...category, archivedAt: '2026-10-26T00:00:00Z', version: category.version + 1 }; },
      mealTypeCodes: { 早餐: 'BREAKFAST', 午餐: 'LUNCH', 晚餐: 'DINNER', 加餐: 'OTHER' }, mealTypeLabel: value => ({ BREAKFAST: '早餐', LUNCH: '午餐', DINNER: '晚餐', OTHER: '加餐' }[value]), ...api,
    },
  };
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename });
  const page = evaluate(compileScript(descriptor, { id: 'meal-usability', inlineTemplate: false }).content, deps, uni).default.setup({}, { expose() {} });
  page.date.value = '2026-10-26';
  return { page, life, modals, writes };
}
async function rendered(page, tap) {
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename });
  const script = compileScript(descriptor, { id: 'meal-usability-render', inlineTemplate: false });
  const compiled = compileTemplate({ source: descriptor.template.content, filename, id: 'meal-usability-render', compilerOptions: { bindingMetadata: script.bindings, isCustomElement: tag => ['view', 'text', 'image', 'input', 'button', 'picker', 'scroll-view'].includes(tag) } });
  assert.deepEqual(compiled.errors, []);
  const { render } = evaluate(compiled.code, { vue }, {});
  let tree;
  const html = await renderToString(vue.createSSRApp({ setup: () => () => { tree = render({}, [], {}, vue.proxyRefs(page)); return tree; } }));
  if (tap) {
    const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.children) : typeof value === 'string' ? value : '';
    const matches = [];
    const visit = value => { if (Array.isArray(value)) return value.forEach(visit); if (!value || typeof value !== 'object') return; if (text(value.children) === tap && typeof value.props?.onTap === 'function') matches.push(value); visit(value.children); };
    visit(tree); assert.equal(matches.length, 1, 'One real rendered tap target: ' + tap);
    await matches[0].props.onTap({ stopPropagation() {} });
  }
  return html;
}

test('U09 recipe library and ordering use the same rendered category controls and category IDs', async () => {
  const { page, life } = form(); await life.show(); page.switchView('recipes');
  await rendered(page, '主食');
  let html = await rendered(page);
  assert.equal(page.category.value, 'cat-main'); assert.match(html, /蛋炒饭/); assert.match(html, /草稿粥/); assert.doesNotMatch(html, /番茄汤|水果拼盘/);
  page.switchView('order'); html = await rendered(page);
  assert.match(html, /蛋炒饭/); assert.doesNotMatch(html, /番茄汤|草稿粥|水果拼盘/);
  await rendered(page, '汤羹'); html = await rendered(page);
  assert.match(html, /番茄汤/); assert.doesNotMatch(html, /蛋炒饭/);
});

test('U09 uncategorized and inactive-category recipes remain reachable without being reassigned', async () => {
  const retired = { id: 'retired', name: '旧分类', sortOrder: 2, version: 2, archivedAt: '2026-10-01T00:00:00Z' };
  const { page, life } = form({ listRecipes: async () => [...structuredClone(rows), recipe('old', '旧菜谱', retired)] });
  await life.show(); page.switchView('recipes');
  await rendered(page, '未分类'); let html = await rendered(page);
  assert.match(html, /水果拼盘/); assert.doesNotMatch(html, /蛋炒饭|旧菜谱/);
  await rendered(page, '旧分类（停用）'); html = await rendered(page);
  assert.match(html, /旧菜谱/); assert.doesNotMatch(html, /水果拼盘/);
  assert.equal(page.recipes.value.find(item => item.id === 'old').category.id, 'retired');
});

test('U08 rename category updates cached labels but preserves association, version checks and selected filter', async () => {
  const { page, life, writes } = form(); await life.show(); page.switchView('recipes');
  await rendered(page, '主食'); await rendered(page, '管理分类');
  page.startCategoryEdit(page.recipeCategories.value[0]); page.categoryEditName.value = ' 家常主食 ';
  await rendered(page, '保存修改');
  assert.equal(writes.length, 1); assert.equal(writes[0].category.version, 5); assert.equal(writes[0].input.name, '家常主食');
  assert.equal(page.category.value, 'cat-main'); assert.equal(page.recipes.value.find(item => item.id === 'rice').category.id, 'cat-main');
  const html = await rendered(page); assert.match(html, /家常主食/); assert.match(html, /蛋炒饭/); assert.doesNotMatch(html, /第\d+版|排序 \d+/);
  assert.equal(page.recipes.value.find(item => item.id === 'rice').category.name, '家常主食');
});

test('U08 category management is secondary and explains deactivation only at confirmation', async () => {
  const { page, life, modals, writes } = form(); await life.show(); page.switchView('recipes');
  let html = await rendered(page); assert.match(html, /管理分类/); assert.doesNotMatch(html, /添加分类|排序0-999|第\d+版|归档/);
  await rendered(page, '管理分类'); html = await rendered(page); assert.match(html, /添加分类/); assert.match(html, /停用/);
  const original = JSON.stringify(page.recipes.value);
  page.confirmCategoryArchive(page.recipeCategories.value[0]);
  assert.match(modals[0].title, /停用/); assert.match(modals[0].content, /已有菜谱/);
  await modals[0].success({ confirm: false }); assert.equal(writes.length, 0);
  page.confirmCategoryArchive(page.recipeCategories.value[0]); await modals[1].success({ confirm: true });
  assert.equal(writes.length, 1); assert.equal(writes[0].archive.id, 'cat-main'); assert.equal(writes[0].archive.version, 5);
  assert.equal(JSON.stringify(page.recipes.value), original); assert.equal(page.recipeCategories.value.some(item => item.id === 'cat-main'), false);
});

test('U06/U07 food screens show concise labels instead of implementation rules or raw server reasons', async () => {
  const comparisons = [
    { key: 'egg', name: '鸡蛋', kind: 'FOOD', required: '2', onHand: null, unit: '个', status: 'UNKNOWN', reason: '未登记同单位库存，不作单位换算' },
    { key: 'salt', name: '盐', kind: 'SEASONING', status: 'PRESENT', reason: '调料仅辅助比对有无，不计算或扣减用量' },
  ];
  const currentMeal = { id: 'meal-a', version: 2, localDate: '2026-10-26', mealType: 'DINNER', slotKey: '', status: 'DRAFT', snapshotVersion: 0, items: [], menu: [{ recipeId: 'rice', recipe: rows[0], cookMultiplier: '1', wantedBy: [] }] };
  const { page, life } = form({ listMeals: async () => [currentMeal], recalculateMeal: async () => comparisons });
  await life.show();
  let html = await rendered(page); assert.doesNotMatch(html, /点击“点这道菜”|选错后|先创建这顿餐点/);
  page.switchView('menu'); html = await rendered(page);
  assert.match(html, /鸡蛋|盐/); assert.match(html, /待确认/);
  assert.doesNotMatch(html, /未登记同单位库存|不作单位换算|调料仅辅助|计算或扣减|动态预估|按快照|库存不自动|保留旧快照/);
  assert.equal(page.comparison.value[0].onHand, null); assert.equal(page.comparison.value[1].status, 'PRESENT');
});

test('U08 category controls respect recipe MANAGE permission', async () => {
  const identity = { ...context, effectivePermissions: { recipes: 'EDIT', meals: 'EDIT' } };
  const { page, life, writes, modals } = form({}, identity); await life.show(); page.switchView('recipes');
  const html = await rendered(page); assert.doesNotMatch(html, /管理分类|添加分类|停用/);
  page.startCategoryEdit(groups[0]); page.confirmCategoryArchive(groups[0]); await page.saveCategory();
  assert.equal(writes.length, 0); assert.equal(modals.length, 0);
});
