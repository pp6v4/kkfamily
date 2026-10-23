const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('vue/compiler-sfc');
const { renderToString } = require('vue/server-renderer');
const filename = path.resolve(__dirname, '../src/pages/archive/index.vue');
const context = { householdId: 'house-a', membershipId: 'member-a', effectivePermissions: { archive: 'MANAGE' } };
const field = { id: 'field-a', key: 'contact', label: '家庭联系人', valueType: 'CONTACT', sensitive: true, visibility: 'MANAGERS', version: 3, valueVersion: 7, hasValue: true, canEdit: true, grants: [], updatedAt: null };
const otherField = { ...field, id: 'field-b', key: 'address', label: '家庭地址', valueType: 'ADDRESS' };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const tick = () => new Promise(setImmediate);
const allowed = (access, module, level = 'VIEW') => ({ VIEW: 1, EDIT: 2, MANAGE: 3 }[access?.effectivePermissions?.[module]] || 0) >= { VIEW: 1, EDIT: 2, MANAGE: 3 }[level];
function evaluate(source, deps, uni) {
  const module = { exports: {} }, code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: id => { if (id in deps) return deps[id]; throw Error('Unexpected import ' + id); }, uni, Date, Error, Promise, console });
  return module.exports;
}
function form(api = {}) {
  let access = context;
  const lifecycle = {}, toasts = [], calls = [];
  const uni = { showToast: input => toasts.push(input.title), showModal() {} };
  const deps = {
    vue, '@dcloudio/uni-app': { onShow: fn => lifecycle.show = fn, onHide: fn => lifecycle.hide = fn, onUnload: fn => lifecycle.unload = fn },
    '../../services/session': { canAccess: allowed, refreshAccess: async () => access }, '../../services/members-api': { listMembers: async () => ({ items: [] }) },
    '../../services/family-api': {
      listArchiveFields: async () => { calls.push('list'); return [field, otherField]; },
      getArchiveValue: async id => ({ value: '虚构私密内容-' + id, valueVersion: 7 }), ...api,
    },
  };
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename });
  const page = evaluate(compileScript(descriptor, { id: 'archive-draft-test', inlineTemplate: false }).content, deps, uni).default.setup({}, { expose() {} });
  return { page, lifecycle, toasts, calls, setAccess: value => access = value };
}
async function renderPage(page) {
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename });
  const script = compileScript(descriptor, { id: 'archive-draft-render', inlineTemplate: false });
  const compiled = compileTemplate({ source: descriptor.template.content, filename, id: 'archive-draft-render', compilerOptions: { bindingMetadata: script.bindings, isCustomElement: tag => ['view', 'text', 'input', 'picker', 'switch', 'textarea'].includes(tag) } });
  assert.deepEqual(compiled.errors, []);
  const { render } = evaluate(compiled.code, { vue }, {});
  let tree;
  const html = await renderToString(vue.createSSRApp({ setup: () => () => { tree = render({}, [], {}, vue.proxyRefs(page)); return tree; } }));
  const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.children) : typeof value === 'string' ? value : '';
  const find = predicate => { const found = []; const visit = value => { if (Array.isArray(value)) { value.forEach(visit); return; } if (!value || typeof value !== 'object') return; if (predicate(value)) found.push(value); visit(value.children); }; visit(tree); return found; };
  const exactlyOne = predicate => { const nodes = find(predicate); assert.equal(nodes.length, 1); return nodes[0]; };
  return {
    html,
    tap: label => exactlyOne(node => typeof node.props?.onTap === 'function' && text(node.children) === label).props.onTap({}),
    open: id => exactlyOne(node => node.key === id && typeof node.props?.onTap === 'function').props.onTap({}),
    input: (placeholder, value) => exactlyOne(node => node.type === 'input' && node.props?.placeholder === placeholder).props['onUpdate:modelValue'](value),
  };
}
async function tap(page, label) { return (await renderPage(page)).tap(label); }
async function open(page, id) { return (await renderPage(page)).open(id); }
async function fillField(page, label, key) {
  const rendered = await renderPage(page);
  rendered.input('字段名称，例如：家庭联系人', label);
  if (key) rendered.input('英文标识，例如 family_contact', key);
}

test('Pending field creation cannot clear a fresh draft opened after rendered cancel or back', async () => {
  for (const cancel of ['取消', '‹ 返回']) {
    const pending = deferred(), sent = [];
    const f = form({ createArchiveField: input => { sent.push(input); return pending.promise; } });
    await f.lifecycle.show(); await tap(f.page, '＋ 新建档案字段'); await fillField(f.page, '旧字段', 'old_field');
    const saving = tap(f.page, '保存字段与授权'); await tick(); assert.equal(sent.length, 1);
    await tap(f.page, cancel); await tap(f.page, '＋ 新建档案字段'); await fillField(f.page, '新草稿', 'new_draft');
    pending.resolve({ ...field, id: 'saved-old', label: '旧字段' }); await saving;
    assert.equal(f.page.showFieldForm.value, true); assert.equal(f.page.selected.value, undefined); assert.equal(f.page.form.value.label, '新草稿'); assert.equal(f.page.form.value.key, 'new_draft');
    assert.equal(f.page.busy.value, false); assert.deepEqual(f.calls, ['list']); assert.deepEqual(f.toasts, []);
    assert.match((await renderPage(f.page)).html, /新建档案字段/);
  }
});

test('Pending value save cannot replace a newly opened field-definition draft or retain its plaintext', async () => {
  const pending = deferred(), sent = [];
  const f = form({ setArchiveValue: (...args) => { sent.push(args); return pending.promise; } });
  await f.lifecycle.show(); await open(f.page, field.id); await tap(f.page, '修改内容');
  f.page.value.value = '正在保存的虚构私密内容';
  const saving = tap(f.page, '加密保存'); await tick(); await tap(f.page, '字段与授权'); await fillField(f.page, '新的字段定义草稿');
  const plaintextAfterSwitch = f.page.value.value;
  pending.resolve({ valueVersion: 8 }); await saving;
  assert.equal(f.page.showFieldForm.value, true); assert.equal(f.page.selected.value.id, field.id); assert.equal(f.page.form.value.label, '新的字段定义草稿');
  assert.equal(plaintextAfterSwitch, ''); assert.equal(f.page.value.value, ''); assert.equal(f.page.revealed.value, false); assert.equal(f.page.editingValue.value, false);
  assert.deepEqual(sent, [[field.id, '正在保存的虚构私密内容', 7]]); assert.deepEqual(f.calls, ['list']); assert.deepEqual(f.toasts, []);
});

test('Definition cancel and reopen expire an older plaintext read without restoring revealed content', async () => {
  const pending = deferred(); const f = form({ getArchiveValue: () => pending.promise });
  await f.lifecycle.show(); await open(f.page, field.id);
  const reading = tap(f.page, '查看内容'); await tick(); await tap(f.page, '字段与授权'); await tap(f.page, '取消');
  pending.resolve({ value: '过期读取的虚构私密内容', valueVersion: 8 }); await reading;
  assert.equal(f.page.selected.value.id, field.id); assert.equal(f.page.showFieldForm.value, false); assert.equal(f.page.value.value, ''); assert.equal(f.page.revealed.value, false);
  const rendered = await renderPage(f.page); assert.match(rendered.html, /••••••••/); assert.doesNotMatch(rendered.html, /过期读取的虚构私密内容/);
});

test('Closing a pending save and reopening another field preserves the new selection and masked value', async () => {
  const pending = deferred(); const f = form({ setArchiveValue: () => pending.promise });
  await f.lifecycle.show(); await open(f.page, field.id); await tap(f.page, '修改内容');
  const saving = tap(f.page, '加密保存'); await tick(); await tap(f.page, '‹ 返回档案'); await open(f.page, otherField.id);
  pending.resolve({ valueVersion: 8 }); await saving;
  assert.equal(f.page.selected.value.id, otherField.id); assert.equal(f.page.value.value, ''); assert.equal(f.page.revealed.value, false); assert.equal(f.page.busy.value, false);
  assert.deepEqual(f.calls, ['list']); assert.deepEqual(f.toasts, []);
});

test('Hide or unload expires pending saves before another household or account opens a new draft', async () => {
  for (const leave of ['hide', 'unload']) for (const identity of ['householdId', 'membershipId']) {
    const pending = deferred(); const f = form({ setArchiveValue: () => pending.promise });
    await f.lifecycle.show(); await open(f.page, field.id); await tap(f.page, '修改内容');
    const saving = tap(f.page, '加密保存'); await tick(); f.lifecycle[leave]();
    assert.equal(f.page.value.value, ''); assert.equal(f.page.revealed.value, false); assert.equal(f.page.selected.value, undefined); assert.equal(f.page.session.value, undefined);
    const next = { ...context, [identity]: 'different' }; f.setAccess(next); await f.lifecycle.show(); await tap(f.page, '＋ 新建档案字段'); await fillField(f.page, '切换后草稿', 'next_account');
    pending.resolve({ valueVersion: 8 }); await saving;
    assert.equal(f.page.session.value[identity], 'different'); assert.equal(f.page.showFieldForm.value, true); assert.equal(f.page.form.value.label, '切换后草稿'); assert.equal(f.page.value.value, ''); assert.equal(f.page.revealed.value, false);
    assert.deepEqual(f.calls, ['list', 'list']); assert.deepEqual(f.toasts, []);
  }
});

test('Normal definition errors retain the draft while viewers cannot save definitions or ungranted values', async () => {
  const sent = []; const f = form({ createArchiveField: async input => { sent.push(input); throw Error('版本冲突'); }, setArchiveValue: async () => sent.push('value') });
  await f.lifecycle.show(); await tap(f.page, '＋ 新建档案字段'); await fillField(f.page, '保留草稿', 'keep_draft'); await tap(f.page, '保存字段与授权');
  assert.equal(f.page.form.value.label, '保留草稿'); assert.equal(f.page.showFieldForm.value, true); assert.equal(f.page.busy.value, false); assert.deepEqual(f.toasts, ['版本冲突']);
  f.setAccess({ ...context, effectivePermissions: { archive: 'VIEW' } }); await f.lifecycle.show(); f.page.open({ ...field, canEdit: false });
  const rendered = await renderPage(f.page); assert.doesNotMatch(rendered.html, /字段与授权|修改内容|加密保存|新建档案字段/);
  await f.page.saveField(); await f.page.saveValue(); assert.equal(sent.length, 1);
});
