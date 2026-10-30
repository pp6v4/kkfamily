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
const filename = path.join(ROOT, 'src/pages/shopping/index.vue');
const identity = { householdId: 'house-a', membershipId: 'member-a', effectivePermissions: { shopping: 'EDIT', inventory: 'EDIT' } };
const existing = { id: 'stock-a', version: 7, ingredient: { name: '面粉', kind: 'FOOD' }, quantity: null, unit: 'kg', location: '橱柜', availability: 'UNKNOWN', expiresAt: '2026-11-01T15:59:59Z' };
class ApiError extends Error { constructor(message, statusCode) { super(message); this.statusCode = statusCode; } }
function evaluate(source, dependencies, uni = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: id => {
    if (id in dependencies) return dependencies[id];
    throw new Error('Unexpected import ' + id);
  }, uni, Date, Error, Map, Promise, console });
  return module.exports;
}
const dates = evaluate(fs.readFileSync(path.join(ROOT, 'src/services/trip-form.ts'), 'utf8'), {});
function canAccess(context, module, level = 'VIEW') {
  const ranks = { VIEW: 1, EDIT: 2, MANAGE: 3 };
  return (ranks[context?.effectivePermissions?.[module]] || 0) >= ranks[level];
}
function fixture({ permission = 'EDIT' } = {}) {
  const lifecycle = {}, stockWrites = [], shoppingWrites = [], toasts = [];
  const stored = { ...identity, effectivePermissions: { shopping: permission, inventory: permission } };
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename });
  const script = compileScript(descriptor, { id: 'inventory-usability', inlineTemplate: false });
  const page = evaluate(script.content, {
    vue,
    '@dcloudio/uni-app': { onShow: fn => lifecycle.show = fn, onHide: fn => lifecycle.hide = fn, onUnload: fn => lifecycle.unload = fn },
    '../../services/session': { canAccess, getStoredSession: () => stored, refreshAccess: async () => stored },
    '../../services/transport': { ApiError }, '../../services/trip-form': dates,
    '../../services/family-api': {
      listShoppingLists: async () => [], listInventory: async () => [existing],
      setInventoryItem: async input => stockWrites.push(input), addShoppingItem: async input => shoppingWrites.push(input),
    },
  }, { showToast: value => toasts.push(value.title) }).default.setup({}, { expose() {} });
  const template = compileTemplate({ source: descriptor.template.content, filename, id: 'inventory-usability', compilerOptions: {
    bindingMetadata: script.bindings, isCustomElement: tag => ['view', 'text', 'input', 'button', 'picker'].includes(tag),
  } });
  assert.deepEqual(template.errors, []);
  const { render } = evaluate(template.code, { vue });
  async function rendered() {
    let tree;
    const html = await renderToString(vue.createSSRApp({ setup: () => () => { tree = render({}, [], {}, vue.proxyRefs(page)); return tree; } }));
    return { html, tree };
  }
  return { page, lifecycle, stockWrites, shoppingWrites, toasts, rendered };
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join('');
  if (typeof node === 'string') return node;
  return node && typeof node === 'object' ? text(node.children) : '';
}
function find(node, predicate) {
  const found = [];
  function visit(value) {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    if (predicate(value)) found.push(value);
    visit(value.children);
  }
  visit(node); return found;
}
function fields(tree) {
  return find(tree, node => String(node.props?.class || '').split(/\s+/).includes('form-field'));
}
function field(tree, label) {
  const matches = fields(tree).filter(node => find(node, child => child.type === 'text' && text(child) === label).length);
  assert.equal(matches.length, 1, 'Exactly one visible labelled field: ' + label);
  return matches[0];
}
function input(tree, label) {
  const controls = find(field(tree, label), node => node.type === 'input');
  assert.equal(controls.length, 1, 'Exactly one input for ' + label); return controls[0];
}
async function fill(f, label, value) {
  const control = input((await f.rendered()).tree, label);
  assert.equal(Boolean(control.props.disabled), false, label + ' is editable');
  assert.equal(typeof control.props['onUpdate:modelValue'], 'function');
  control.props['onUpdate:modelValue'](value);
}
async function tap(f, label) {
  const buttons = find((await f.rendered()).tree, node => node.type === 'button' && text(node) === label);
  assert.equal(buttons.length, 1, 'Exactly one visible button: ' + label);
  assert.equal(Boolean(buttons[0].props.disabled), false);
  return buttons[0].props.onTap({ type: 'tap' });
}

test('Inventory labels stay visible after typing and optional location starts blank rather than prefilled kitchen', async () => {
  const f = fixture(); await f.lifecycle.show(); f.page.switchView('inventory'); await tap(f, '＋ 登记库存');
  assert.equal(f.page.stockItem.value.location, '');
  await fill(f, '食材名称', '番茄');
  const { tree, html } = await f.rendered();
  for (const label of ['库存类型', '食材名称', '数量（选填）', '计量单位', '现有情况', '存放位置（选填）', '到期日（选填）']) field(tree, label);
  assert.equal(input(tree, '食材名称').dirs[0].value, '番茄');
  assert.match(input(tree, '食材名称').props.placeholder, /番茄|鸡蛋/);
  assert.match(input(tree, '存放位置（选填）').props.placeholder, /冰箱|橱柜/);
  assert.match(input(tree, '计量单位').props.placeholder, /g.*kg.*个/);
  assert.match(html, /选择日期/);
  assert.doesNotMatch(html, /库存仅辅助判断|不自动换算单位|购买和做饭不会自动增减库存|数量留空可登记有、无或待确认|调料只登记有无/);
});

test('Rendered inventory submission omits empty optional location and preserves unknown quantity with its unit', async () => {
  const f = fixture(); await f.lifecycle.show(); f.page.switchView('inventory'); await tap(f, '＋ 登记库存');
  await fill(f, '食材名称', ' 面粉 '); await fill(f, '计量单位', ' kg ');
  await tap(f, '登记库存');
  assert.equal(f.stockWrites.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.stockWrites[0])), { name: '面粉', kind: 'FOOD', unit: 'kg', availability: 'UNKNOWN' });
  assert.equal(f.stockWrites[0].quantity, undefined); assert.equal(f.stockWrites[0].location, undefined);
  assert.equal(f.page.stockItem.value.location, '');
});

test('Rendered food inputs submit exact numeric amount, explicit location and Shanghai end-of-day expiry', async () => {
  const f = fixture(); await f.lifecycle.show(); f.page.switchView('inventory'); await tap(f, '＋ 登记库存');
  await fill(f, '食材名称', ' 番茄 '); await fill(f, '数量（选填）', '200.125');
  await fill(f, '计量单位', ' g '); await fill(f, '存放位置（选填）', ' 冰箱冷藏室 ');
  const picker = find(field((await f.rendered()).tree, '到期日（选填）'), node => node.type === 'picker')[0];
  assert.equal(picker.props.mode, 'date'); picker.props.onChange({ detail: { value: '2026-11-03' } });
  await tap(f, '登记库存');
  assert.deepEqual(JSON.parse(JSON.stringify(f.stockWrites[0])), { name: '番茄', kind: 'FOOD', unit: 'g', quantity: 200.125, location: '冰箱冷藏室', expiresAt: '2026-11-03T23:59:59+08:00' });
  assert.equal(f.shoppingWrites.length, 0);
});

test('Seasoning labels do not expose food quantities and retain availability-only payload', async () => {
  const f = fixture(); await f.lifecycle.show(); f.page.switchView('inventory'); await tap(f, '＋ 登记库存');
  const type = field((await f.rendered()).tree, '库存类型');
  const seasoning = find(type, node => node.type === 'text' && text(node) === '调料' && typeof node.props?.onTap === 'function')[0];
  seasoning.props.onTap({}); await fill(f, '调料名称', ' 生抽 ');
  const { tree } = await f.rendered();
  assert.equal(find(tree, node => node.type === 'input').length, 2);
  const availability = find(field(tree, '现有情况'), node => node.type === 'text' && text(node) === '有' && typeof node.props?.onTap === 'function')[0];
  availability.props.onTap({}); await tap(f, '登记库存');
  assert.deepEqual(JSON.parse(JSON.stringify(f.stockWrites[0])), { name: '生抽', kind: 'SEASONING', availability: 'PRESENT' });
});

test('Existing inventory edit keeps original name/unit/location and version while only adjusting supplied fields', async () => {
  const f = fixture(); await f.lifecycle.show(); f.page.switchView('inventory'); f.page.editStock(existing);
  const { tree } = await f.rendered();
  for (const label of ['食材名称', '计量单位', '存放位置（选填）']) assert.equal(input(tree, label).props.disabled, true);
  assert.equal(input(tree, '存放位置（选填）').dirs[0].value, '橱柜');
  await fill(f, '数量（选填）', '0'); await tap(f, '保存核实后的库存');
  assert.deepEqual(JSON.parse(JSON.stringify(f.stockWrites[0])), { name: '面粉', kind: 'FOOD', unit: 'kg', quantity: 0, location: '橱柜', expiresAt: '2026-11-01T23:59:59+08:00', id: 'stock-a', expectedVersion: 7 });
});

test('Shopping form has persistent labels and submits unchanged list status without any inventory write', async () => {
  const f = fixture(); await f.lifecycle.show(); await tap(f, '＋ 添加物品');
  for (const label of ['商品名称', '数量（选填）', '单位（选填）', '购物分类']) field((await f.rendered()).tree, label);
  await fill(f, '商品名称', ' 洗衣液 '); await fill(f, '数量（选填）', '2'); await fill(f, '单位（选填）', ' 瓶 ');
  await tap(f, '记到清单');
  assert.deepEqual(JSON.parse(JSON.stringify(f.shoppingWrites[0])), { name: '洗衣液', quantity: 2, unit: '瓶', status: 'NEXT_TRIP' });
  assert.equal(f.stockWrites.length, 0);
});

test('Read-only inventory still displays saved location but no editable fields or register action', async () => {
  const f = fixture({ permission: 'VIEW' }); await f.lifecycle.show(); f.page.switchView('inventory');
  const { tree, html } = await f.rendered(); assert.equal(fields(tree).length, 0);
  assert.match(html, /橱柜/); assert.doesNotMatch(html, /登记库存|保存核实后的库存|库存仅辅助判断/);
  await f.page.saveStock(); assert.equal(f.stockWrites.length, 0);
});
test('UI09 lists open first, collapsed forms retain input, and successful submit closes the form', async () => {
  const f=fixture();await f.lifecycle.show();
  let rendered=await f.rendered();assert.equal(fields(rendered.tree).length,0);
  await tap(f,'＋ 添加物品');await fill(f,'商品名称','保留的购物草稿');
  await tap(f,'收起添加');assert.equal(fields((await f.rendered()).tree).length,0);
  await tap(f,'＋ 添加物品');assert.equal(input((await f.rendered()).tree,'商品名称').dirs[0].value,'保留的购物草稿');
  await tap(f,'记到清单');assert.equal(f.shoppingWrites.length,1);assert.equal(fields((await f.rendered()).tree).length,0);
  f.page.switchView('inventory');assert.equal(fields((await f.rendered()).tree).length,0);
  await tap(f,'＋ 登记库存');await fill(f,'食材名称','保留的食材草稿');await tap(f,'收起登记');await tap(f,'＋ 登记库存');
  assert.equal(input((await f.rendered()).tree,'食材名称').dirs[0].value,'保留的食材草稿');
});
