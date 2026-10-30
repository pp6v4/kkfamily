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
const filename = path.join(ROOT, 'src/pages/tasks/index.vue');
const context = { householdId: 'house-a', membershipId: 'member-a', effectivePermissions: { tasks: 'MANAGE' } };
const original = {
  id: 'task-a', version: 6, type: 'TODO', title: '清洗空调', description: '保留说明',
  assigneeMembershipId: 'member-a', assignee: { id: 'member-a', user: { nickname: '家人' } },
  createdBy: { id: 'creator-a', user: { nickname: '创建者' } }, priority: 'NORMAL', status: 'PENDING',
  dueAt: '2026-10-24T20:30:17.123Z', reminderAt: '2026-10-24T17:15:12.987Z', history: [],
};
function evaluate(source, dependencies, uni = {}) {
  const module = { exports: {} };
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  vm.runInNewContext(compiled.outputText, { module, exports: module.exports, require: id => {
    if (id in dependencies) return dependencies[id];
    throw new Error('Unexpected dependency: ' + id);
  }, uni, Date, Error, console });
  return module.exports;
}
const tripForm = evaluate(fs.readFileSync(path.join(ROOT, 'src/services/trip-form.ts'), 'utf8'), {});
const ranks = { VIEW: 1, EDIT: 2, MANAGE: 3 };
function canAccess(member, module, level = 'VIEW') { return (ranks[member?.effectivePermissions?.[module]] || 0) >= ranks[level]; }
function fixture({ task = {}, permission = 'MANAGE', update } = {}) {
  const writes = [], creates = [], lifecycle = {};
  const identity = { ...context, effectivePermissions: { tasks: permission } };
  const uni = { showToast() {} };
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename });
  const script = compileScript(descriptor, { id: 'task-date-clear', inlineTemplate: false });
  const page = evaluate(script.content, {
    vue,
    '@dcloudio/uni-app': { onHide: fn => lifecycle.hide = fn, onUnload() {}, onLoad() {}, onShow() {} },
    '../../services/session': { canAccess, refreshAccess: async () => identity },
    '../../services/trip-form': tripForm,
    '../../services/family-api': {
      updateTask: async (row, input) => {
        writes.push({ id: row.id, expectedVersion: row.version, input: JSON.parse(JSON.stringify(input)) });
        return update ? update(row, input) : { ...row, ...input, version: row.version + 1 };
      },
      createTask: async input => { creates.push(JSON.parse(JSON.stringify(input))); return { ...original, ...input, id: 'new-task' }; },
    },
  }, uni).default.setup({}, { expose() {} });
  page.session.value = identity;
  page.assignees.value = [{ id: 'member-a', user: { nickname: '家人' } }];
  page.selected.value = structuredClone({ ...original, ...task });
  const template = compileTemplate({ source: descriptor.template.content, filename, id: 'task-date-clear', compilerOptions: {
    bindingMetadata: script.bindings, isCustomElement: tag => ['view', 'text', 'input', 'textarea', 'picker', 'button'].includes(tag),
  } });
  assert.deepEqual(template.errors, []);
  const { render } = evaluate(template.code, { vue });
  async function vnode() {
    let result;
    await renderToString(vue.createSSRApp({ setup: () => () => { result = render({}, [], {}, vue.proxyRefs(page)); return result; } }));
    return result;
  }
  return { page, writes, creates, lifecycle, vnode };
}
function textOf(node) {
  if (typeof node === 'string') return node;
  if (!node || typeof node !== 'object') return '';
  return Array.isArray(node.children) ? node.children.map(textOf).join('') : typeof node.children === 'string' ? node.children : '';
}
function findTap(node, label) {
  if (!node || typeof node !== 'object') return undefined;
  if (typeof node.props?.onTap === 'function' && textOf(node) === label) return node.props.onTap;
  for (const child of Array.isArray(node.children) ? node.children : []) { const result = findTap(child, label); if (result) return result; }
}
async function tap(f, label) {
  const handler = findTap(await f.vnode(), label);
  assert.equal(typeof handler, 'function', 'Rendered task page must expose ' + label);
  return handler({ type: 'tap' });
}

test('Rendered edit can clear only its reminder and submit null without altering the deadline or source record', async () => {
  const f = fixture(); f.page.editTask();
  assert.equal(f.page.form.value.reminderDate, '2026-10-25');
  await tap(f, '清除提醒日期');
  assert.equal(f.page.form.value.reminderDate, ''); assert.equal(f.page.form.value.dueDate, '2026-10-25');
  assert.equal(f.page.selected.value.reminderAt, original.reminderAt); assert.equal(f.writes.length, 0);
  await tap(f, '保存修改');
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].id, original.id); assert.equal(f.writes[0].expectedVersion, 6);
  assert.equal(f.writes[0].input.reminderAt, null); assert.equal(f.writes[0].input.dueAt, original.dueAt);
  assert.equal(f.page.selected.value.reminderAt, null); assert.equal(f.page.selected.value.dueAt, original.dueAt);
});

test('Rendered edit can clear only its deadline while retaining the exact reminder instant', async () => {
  const f = fixture(); f.page.editTask();
  await tap(f, '清除截止日期');
  assert.equal(f.page.form.value.dueDate, ''); assert.equal(f.page.form.value.reminderDate, '2026-10-25');
  assert.equal(f.page.selected.value.dueAt, original.dueAt); assert.equal(f.writes.length, 0);
  await tap(f, '保存修改');
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].input.dueAt, null);
  assert.equal(f.writes[0].input.reminderAt, original.reminderAt);
});

test('Clearing both optional dates submits two explicit nulls and removes both clear actions', async () => {
  const f = fixture(); f.page.editTask();
  await tap(f, '清除截止日期'); await tap(f, '清除提醒日期');
  const node = await f.vnode();
  assert.equal(findTap(node, '清除截止日期'), undefined); assert.equal(findTap(node, '清除提醒日期'), undefined);
  await tap(f, '保存修改');
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].input.dueAt, null); assert.equal(f.writes[0].input.reminderAt, null);
});

test('Saving unchanged dates preserves both exact cross-day timestamps including milliseconds', async () => {
  const f = fixture(); f.page.editTask(); f.page.form.value.title = '清洗客厅空调';
  await tap(f, '保存修改');
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].input.dueAt, original.dueAt);
  assert.equal(f.writes[0].input.reminderAt, original.reminderAt); assert.equal(f.writes[0].input.title, '清洗客厅空调');
});

test('Cancelling date edits never writes, expires the old save binding and restores dates on re-entry', async () => {
  const f = fixture(); f.page.editTask();
  const save = findTap(await f.vnode(), '保存修改');
  await tap(f, '清除截止日期'); await tap(f, '清除提醒日期'); await tap(f, '取消');
  assert.equal(f.writes.length, 0); assert.equal(f.page.showingForm.value, false);
  await save({ type: 'tap' }); assert.equal(f.writes.length, 0);
  assert.equal(f.page.selected.value.dueAt, original.dueAt); assert.equal(f.page.selected.value.reminderAt, original.reminderAt);
  f.page.editTask();
  assert.equal(f.page.form.value.dueDate, '2026-10-25'); assert.equal(f.page.form.value.reminderDate, '2026-10-25');
});

test('Read-only and unrelated editors cannot enter date editing or use previously rendered clear/save bindings', async () => {
  for (const change of ['readonly', 'unrelated', 'hidden']) {
    const f = fixture(); f.page.editTask();
    const node = await f.vnode(), clearDue = findTap(node, '清除截止日期'), clearReminder = findTap(node, '清除提醒日期'), save = findTap(node, '保存修改');
    assert.equal(typeof clearDue, 'function'); assert.equal(typeof clearReminder, 'function');
    if (change === 'readonly') f.page.session.value = { ...context, effectivePermissions: { tasks: 'VIEW' } };
    if (change === 'unrelated') f.page.session.value = { ...context, membershipId: 'unrelated', effectivePermissions: { tasks: 'EDIT' } };
    if (change === 'hidden') f.lifecycle.hide();
    const before = { ...f.page.form.value };
    await clearDue({ type: 'tap' }); await clearReminder({ type: 'tap' }); await save({ type: 'tap' });
    assert.equal(f.page.form.value.dueDate, before.dueDate); assert.equal(f.page.form.value.reminderDate, before.reminderDate);
    assert.equal(f.writes.length, 0); assert.equal(f.creates.length, 0);
    if (change !== 'hidden') { f.page.showingForm.value = false; f.page.editTask(); assert.equal(f.page.showingForm.value, false); }
  }
});

test('A pending save locks clear actions and repeated save taps without changing the submitted dates', async () => {
  let finish;
  const f = fixture({ update: (row, input) => new Promise(resolve => { finish = () => resolve({ ...row, ...input, version: 7 }); }) });
  f.page.editTask();
  const node = await f.vnode(), clearDue = findTap(node, '清除截止日期'), clearReminder = findTap(node, '清除提醒日期'), save = findTap(node, '保存修改');
  assert.equal(typeof clearDue, 'function'); assert.equal(typeof clearReminder, 'function');
  const saving = save({ type: 'tap' });
  await clearDue({ type: 'tap' }); await clearReminder({ type: 'tap' }); await save({ type: 'tap' });
  assert.equal(f.page.form.value.dueDate, '2026-10-25'); assert.equal(f.page.form.value.reminderDate, '2026-10-25');
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].input.dueAt, original.dueAt); assert.equal(f.writes[0].input.reminderAt, original.reminderAt);
  finish(); await saving; assert.equal(f.page.busy.value, false);
});

test('Clearing dates preserves existing terminal-task edit authority without reopening or changing its status', async () => {
  for (const status of ['COMPLETED', 'CANCELLED']) {
    const f = fixture({ task: { status } }); f.page.editTask();
    await tap(f, '清除提醒日期'); await tap(f, '保存修改');
    assert.equal(f.writes.length, 1); assert.equal(f.page.selected.value.status, status);
    assert.equal(Object.hasOwn(f.writes[0].input, 'status'), false);
    const denied = fixture({ permission: 'EDIT', task: { status, assigneeMembershipId: 'another-member', createdBy: { id: context.membershipId } } });
    denied.page.editTask(); assert.equal(denied.page.showingForm.value, false); assert.equal(denied.writes.length, 0);
  }
});

test('New task date clearing still sends omitted optional dates rather than update nulls', async () => {
  const f = fixture(); f.page.selected.value = undefined; f.page.newTask();
  f.page.form.value.title = '新事项'; f.page.form.value.dueDate = '2026-10-25'; f.page.form.value.reminderDate = '2026-10-24';
  await tap(f, '清除截止日期'); await tap(f, '清除提醒日期'); await tap(f, '保存待办');
  assert.equal(f.creates.length, 1); assert.equal(Object.hasOwn(f.creates[0], 'dueAt'), false);
  assert.equal(Object.hasOwn(f.creates[0], 'reminderAt'), false); assert.equal(f.writes.length, 0);
});
