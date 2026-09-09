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
function evaluate(source, deps, uni) {
  const module = { exports: {} };
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  vm.runInNewContext(compiled.outputText, { module, exports: module.exports, require: id => {
    if (id in deps) return deps[id];
    throw new Error('Unexpected dependency: ' + id);
  }, uni, Date, Error, console });
  return module.exports;
}
const travel = evaluate(fs.readFileSync(path.join(ROOT, 'src/services/trip-form.ts'), 'utf8'), {}, {});
function dates() { return evaluate(fs.readFileSync(path.join(ROOT, 'src/services/calendar-dates.ts'), 'utf8'), { './trip-form': travel }, {}); }
const context = { householdId: 'house-a', householdName: '测试家庭', membershipId: 'member-a', accessToken: 'test-token', roles: [], effectivePermissions: { calendar: 'EDIT', meals: 'EDIT', trips: 'EDIT', tasks: 'EDIT' } };
const record = { id: 'anniversary:a:2026-09-09', type: 'ANNIVERSARY', sourceId: 'a', title: '纪念日', localDate: '2020-09-09', startsAt: '2026-09-08T16:00:00Z', version: 3, recurrence: 'YEARLY', leapPolicy: 'FEB_28', note: '旧备注' };
const allowed = (member, module, level = 'VIEW') => ({ VIEW: 1, EDIT: 2, MANAGE: 3 }[member?.effectivePermissions?.[module]] || 0) >= ({ VIEW: 1, EDIT: 2, MANAGE: 3 }[level]);
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const tick = () => new Promise(setImmediate);
function form(kind = 'date-detail', api = {}, access) {
  const lifecycle = {}, toasts = [], routes = [], modals = [];
  let stored = context;
  const uni = { showToast: item => toasts.push(item.title), showModal: item => modals.push(item), navigateTo: item => routes.push(item.url), switchTab: item => routes.push(item.url) };
  const session = { canAccess: allowed, getStoredSession: () => stored, refreshAccess: async () => {
    const result = access ? await access() : stored;
    return result;
  } };
  const filename = path.join(ROOT, `src/pages/${kind}/index.vue`);
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename });
  const compiled = compileScript(descriptor, { id: 'calendar-test', inlineTemplate: false });
  const deps = {
    vue,
    '@dcloudio/uni-app': { onLoad: fn => lifecycle.load = fn, onShow: fn => lifecycle.show = fn, onHide: fn => lifecycle.hide = fn, onUnload: fn => lifecycle.unload = fn },
    '../../services/session': session,
    '../../services/trip-form': travel,
    '../../services/calendar-dates': fs.existsSync(path.join(ROOT, 'src/services/calendar-dates.ts')) ? dates() : {},
    '../../services/transport': { ApiError },
    '../../services/calendar-navigation': { setCalendarTarget() {} },
    '../../services/family-api': { listCalendarEvents: async () => [record], ...api },
  };
  const page = evaluate(compiled.content, deps, uni).default.setup({}, { expose() {} });
  lifecycle.load?.({ date: '2026-09-09' });
  return { page, lifecycle, toasts, routes, modals, setStored: value => { stored = value; } };
}

test('Calendar late month response cannot replace the latest selected month', async () => {
  const old = deferred(); let calls = 0;
  const { page, lifecycle } = form('index', { listCalendarEvents: () => ++calls === 1 ? old.promise : Promise.resolve([{ ...record, id: 'new' }]) });
  const pending = lifecycle.show(); await tick(); await page.changeMonth(1);
  old.resolve([record]); await pending;
  assert.equal(page.events.value[0].id, 'new');
});

test('Both calendar pages clear private data on hide/unload and discard late reads', async () => {
  for (const kind of ['index', 'date-detail']) for (const ending of ['hide', 'unload']) {
    const rows = deferred(); const { page, lifecycle } = form(kind, { listCalendarEvents: () => rows.promise });
    const pending = lifecycle.show(); await tick();
    if (kind === 'date-detail') { page.beginCreate(); page.title.value = '私密草稿'; page.note.value = '内容'; }
    lifecycle[ending](); rows.resolve([record]); await pending;
    assert.equal(page.events.value.length, 0); assert.equal(page.session.value, undefined); assert.equal(page.loading.value, false);
    if (kind === 'date-detail') { assert.equal(page.title.value, ''); assert.equal(page.note.value, ''); assert.equal(page.adding.value, false); }
    if (ending === 'unload') { await lifecycle.show(); assert.equal(page.session.value, undefined); }
  }
});

test('Calendar permission refresh clears prior data and denial makes no calendar request', async () => {
  for (const kind of ['index', 'date-detail']) {
    let deny = false, reads = 0;
    const { page, lifecycle } = form(kind, { listCalendarEvents: async () => { reads++; return [record]; } }, async () => deny ? { ...context, effectivePermissions: {} } : context);
    await lifecycle.show(); deny = true;
    const loading = kind === 'index' ? page.loadMonth() : page.loadEvents();
    assert.equal(page.events.value.length, 0); assert.equal(page.session.value, undefined);
    await loading; assert.equal(reads, 1); assert.match(page.loadError.value, /权限/);
  }
});

test('Calendar identity changes invalidate pending access and reads without leaking data or navigation', async () => {
  for (const kind of ['index', 'date-detail']) for (const stage of ['access', 'rows']) {
    const pending = deferred(); let reads = 0;
    const { page, lifecycle, setStored, routes } = form(kind, { listCalendarEvents: async () => { reads++; return stage === 'rows' ? pending.promise : [record]; } }, () => stage === 'access' ? pending.promise : Promise.resolve(context));
    const showing = lifecycle.show(); await tick(); setStored({ ...context, householdId: 'house-b', membershipId: 'member-b' });
    pending.resolve(stage === 'access' ? context : [record]); await showing;
    assert.equal(page.events.value.length, 0); assert.equal(page.session.value, undefined); assert.equal(page.loading.value, false);
    if (stage === 'access') assert.equal(reads, 0);
    if (kind === 'index') page.selectDay('2026-09-09'); else { page.beginCreate(); page.planMeal(); }
    assert.equal(routes.length, 0);
  }
});

test('Day calendar save prevents duplicate creation and sends explicit anniversary values', async () => {
  const saved = deferred(), writes = [];
  const { page, lifecycle, toasts } = form('date-detail', { createAnniversary: input => { writes.push(input); return saved.promise; } });
  await lifecycle.show(); page.beginCreate(); page.title.value = ' 新纪念日 '; page.note.value = ' 新备注 ';
  page.anniversaryDate.value = '2028-02-29'; page.leapPolicy.value = 'MAR_1';
  const first = page.saveEvent(); const second = page.saveEvent(); const count = writes.length;
  saved.resolve({}); await Promise.all([first, second]); assert.equal(count, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0])), { title: '新纪念日', note: '新备注', localDate: '2028-02-29', recurrence: 'YEARLY', leapPolicy: 'MAR_1' });
  assert.equal(page.adding.value, false); assert.equal(page.saving.value, false); assert.equal(toasts.at(-1), '已添加');
});

test('Day calendar blocks invalid dates and preserves version when clearing anniversary notes', async () => {
  const writes = [];
  const { page, lifecycle } = form('date-detail', { updateAnniversary: async (target, input) => { writes.push({ target, input }); } });
  await lifecycle.show(); page.beginEdit(page.events.value[0]);
  for (const value of ['2026-02-29', '2028-02-30', '2026-04-31', 'bad']) { page.anniversaryDate.value = value; await page.saveEvent(); }
  assert.equal(writes.length, 0);
  page.anniversaryDate.value = '2028-02-29'; page.title.value = ' 更新 '; page.note.value = ' '; await page.saveEvent();
  assert.equal(writes.length, 1); assert.equal(writes[0].target.id, 'a'); assert.equal(writes[0].target.version, 3); assert.equal(writes[0].input.note, null); assert.equal(writes[0].input.title, '更新');
});

test('Day calendar stale delete confirmations expire on editor change, hiding or family change', async () => {
  for (const action of ['close', 'replace', 'hide', 'identity']) {
    let writes = 0; const { page, lifecycle, modals, setStored } = form('date-detail', { archiveAnniversary: async () => writes++ });
    await lifecycle.show(); page.beginEdit(page.events.value[0]); page.removeEvent(); assert.equal(modals.length, 1);
    if (action === 'close') page.closeEditor();
    if (action === 'replace') { page.closeEditor(); page.beginEdit(page.events.value[0]); }
    if (action === 'hide') lifecycle.hide();
    if (action === 'identity') setStored({ ...context, membershipId: 'member-b' });
    await modals[0].success({ confirm: true }); assert.equal(writes, 0);
  }
});

test('Day calendar completed writes after hide do not reload, restore drafts or show stale success', async () => {
  for (const change of ['hide', 'identity']) {
    const saved = deferred(); let reads = 0;
    const { page, lifecycle, toasts, setStored } = form('date-detail', { listCalendarEvents: async () => { reads++; return [record]; }, createAnniversary: () => saved.promise });
    await lifecycle.show(); page.beginCreate(); page.title.value = '纪念日'; const pending = page.saveEvent();
    if (change === 'hide') lifecycle.hide(); else setStored({ ...context, householdId: 'house-b' });
    saved.resolve({}); await pending;
    assert.equal(reads, 1); assert.equal(toasts.includes('已添加'), false); assert.equal(page.events.value.length, 0); assert.equal(page.title.value, ''); assert.equal(page.saving.value, false);
  }
});

test('Day calendar permission failure clears private content; version conflict keeps editable draft', async () => {
  for (const code of [401, 403, 409]) {
    const { page, lifecycle, toasts } = form('date-detail', { updateAnniversary: async () => { throw new ApiError('test-' + code, code); } });
    await lifecycle.show(); page.beginEdit(page.events.value[0]); page.title.value = '新名称'; await page.saveEvent();
    assert.equal(page.saving.value, false);
    if (code === 409) { assert.equal(page.title.value, '新名称'); assert.equal(page.editing.value.version, 3); assert.equal(page.adding.value, true); }
    else { assert.equal(page.events.value.length, 0); assert.equal(page.session.value, undefined); assert.equal(page.title.value, ''); }
    assert.equal(toasts.at(-1), 'test-' + code);
  }
});

test('Day calendar invalid route date makes no API request and loading/error are not empty-state success', async () => {
  let reads = 0; const { page, lifecycle } = form('date-detail', { listCalendarEvents: async () => { reads++; return []; } });
  lifecycle.load({ date: '2026-02-29' }); await lifecycle.show();
  assert.equal(reads, 0); assert.match(page.loadError.value, /有效日期/); assert.equal(page.loading.value, false);
});

test('Calendar month grid and exclusive bounds are Shanghai calendar dates in every device timezone', () => {
  const helper = dates();
  assert.equal(helper.todayInShanghai(new Date('2026-08-31T16:00:00Z')), '2026-09-01');
  const grid = helper.monthGrid('2026-09-01');
  assert.equal(grid.length, 42); assert.equal(grid[0].key, '2026-08-30'); assert.equal(grid[41].key, '2026-10-10');
  const range = helper.gridRange('2026-09-01'); assert.equal(range.from, '2026-08-30T00:00:00+08:00'); assert.equal(range.to, '2026-10-11T00:00:00+08:00');
  assert.equal(helper.shiftMonth('2026-12-01', 1), '2027-01-01'); assert.equal(helper.shiftMonth('2026-01-01', -1), '2025-12-01');
  assert.ok(helper.monthGrid('2028-02-01').some(day => day.key === '2028-02-29'));
  assert.equal(helper.overlapsDay({ startsAt: '2026-08-30T00:00:00+08:00', endsAt: '2026-09-02T00:00:00+08:00' }, '2026-09-01'), true);
  assert.equal(helper.overlapsDay({ startsAt: '2026-08-30T00:00:00+08:00', endsAt: '2026-09-02T00:00:00+08:00' }, '2026-09-02'), false);
  assert.equal(helper.overlapsDay({ startsAt: '2026-09-01T16:00:00Z', endsAt: null }, '2026-09-02'), true);
});

test('Month page queries all visible cells with exact Shanghai bounds and renders adjacent-month events', async () => {
  const requests = [];
  const { page, lifecycle } = form('index', { listCalendarEvents: async (from, to) => {
    requests.push({ from, to }); return [{ ...record, startsAt: '2026-08-29T16:00:00Z' }];
  } });
  page.current.value = '2026-09-01'; await lifecycle.show();
  assert.deepEqual(requests, [{ from: '2026-08-30T00:00:00+08:00', to: '2026-10-11T00:00:00+08:00' }]);
  assert.equal(page.days.value[0].isCurrent, false); assert.equal(page.days.value[0].events[0].id, record.id);
  assert.equal(page.days.value[1].events.length, 0);
});

test('Older failed calendar reads cannot erase newer success, finish its loading or display a stale error', async () => {
  for (const kind of ['index', 'date-detail']) {
    const first = deferred(), second = deferred(); let calls = 0;
    const { page, lifecycle, toasts } = form(kind, { listCalendarEvents: () => ++calls === 1 ? first.promise : second.promise });
    const old = lifecycle.show(); await tick(); const next = lifecycle.show(); await tick();
    first.reject(new ApiError('old denied', 403)); await old;
    assert.equal(page.loading.value, true); assert.equal(page.loadError.value, '');
    second.resolve([record]); await next;
    assert.equal(page.events.value[0].id, record.id); assert.equal(toasts.length, 0); assert.equal(page.loading.value, false);
  }
});

test('Read-only or revoked calendar cannot submit lingering editors or navigate through hidden pages', async () => {
  for (const mode of ['readonly', 'hidden', 'identity']) {
    let writes = 0;
    const { page, lifecycle, setStored, routes, modals } = form('date-detail', { createAnniversary: async () => writes++, updateAnniversary: async () => writes++, archiveAnniversary: async () => writes++ },
      async () => mode === 'readonly' ? { ...context, effectivePermissions: { calendar: 'VIEW' } } : context);
    await lifecycle.show();
    if (mode === 'hidden') lifecycle.hide();
    if (mode === 'identity') setStored(undefined);
    page.adding.value = true; page.title.value = '残留草稿'; page.anniversaryDate.value = '2026-09-09';
    await page.saveEvent(); page.editing.value = { id: 'a', version: 3 }; page.removeEvent(); page.planMeal();
    assert.equal(writes, 0); assert.equal(modals.length, 0); assert.equal(routes.length, 0);
  }
});

test('Deletion submits the captured version once; cancellation is side-effect free', async () => {
  const pending = deferred(), writes = [];
  const { page, lifecycle, modals, toasts } = form('date-detail', { archiveAnniversary: target => { writes.push(target); return pending.promise; } });
  await lifecycle.show(); page.beginEdit(page.events.value[0]); page.removeEvent();
  await modals[0].success({ confirm: false }); assert.equal(writes.length, 0); assert.equal(page.adding.value, true);
  page.removeEvent(); const first = modals[1].success({ confirm: true });
  await modals[1].success({ confirm: true }); assert.equal(writes.length, 1); assert.equal(writes[0].id, 'a'); assert.equal(writes[0].version, 3);
  pending.resolve({}); await first; assert.equal(page.saving.value, false); assert.equal(page.adding.value, false); assert.equal(toasts.at(-1), '已删除');
});

test('Pending create keeps its write lock across hide/show and cannot overwrite the returning view', async () => {
  const pending = deferred(); let writes = 0, reads = 0;
  const { page, lifecycle, toasts } = form('date-detail', { createAnniversary: () => { writes++; return pending.promise; }, listCalendarEvents: async () => { reads++; return [record]; } });
  await lifecycle.show(); page.beginCreate(); page.title.value = '新纪念日'; const saving = page.saveEvent();
  lifecycle.hide(); await lifecycle.show(); page.beginCreate();
  assert.equal(page.adding.value, false); assert.equal(page.saving.value, true);
  await page.saveEvent(); assert.equal(writes, 1); pending.resolve({}); await saving;
  assert.equal(reads, 2); assert.equal(toasts.length, 0); assert.equal(page.events.value[0].id, record.id); assert.equal(page.saving.value, false);
  page.beginCreate(); assert.equal(page.adding.value, true);
});

test('Current load failure is retryable and distinct from an empty successful calendar', async () => {
  for (const kind of ['index', 'date-detail']) {
    let fail = true; const { page, lifecycle } = form(kind, { listCalendarEvents: async () => { if (fail) throw new Error('网络不可用'); return []; } });
    await lifecycle.show(); assert.equal(page.loadError.value, '网络不可用'); assert.equal(page.session.value, undefined);
    fail = false; await lifecycle.show(); assert.equal(page.loadError.value, ''); assert.equal(page.events.value.length, 0); assert.equal(page.session.value.householdId, context.householdId);
  }
});

test('Day query spans precisely one Shanghai date and only current source events may open details', async () => {
  const requests = [], rows = ['MEAL', 'TRIP', 'TASK'].map(type => ({ ...record, id: type, sourceId: type.toLowerCase(), type }));
  const { page, lifecycle, routes } = form('date-detail', { listCalendarEvents: async (from, to) => { requests.push({ from, to }); return rows; } });
  lifecycle.load({ date: '2028-02-29' }); await lifecycle.show();
  assert.deepEqual(requests, [{ from: '2028-02-29T00:00:00+08:00', to: '2028-02-29T16:00:00.000Z' }]);
  for (const row of rows) page.openEvent(row);
  assert.deepEqual(routes, ['/pages/meal/index', '/pages/camping/index', '/pages/tasks/index?id=task']);
  page.openEvent({ ...rows[0], id: 'old-event' }); assert.equal(routes.length, 3);
});

test('Saving anniversary locks date/repeat controls and preserves the submitted draft', async () => {
  const pending = deferred();
  const { page, lifecycle } = form('date-detail', { createAnniversary: () => pending.promise });
  await lifecycle.show(); page.beginCreate(); page.title.value = '纪念日'; const saving = page.saveEvent();
  page.pickDate({ detail: { value: '2028-02-29' } }); page.pickRecurrence('ONCE'); page.pickLeapPolicy('SKIP'); page.closeEditor();
  assert.equal(page.anniversaryDate.value, '2026-09-09'); assert.equal(page.recurrence.value, 'YEARLY'); assert.equal(page.leapPolicy.value, 'FEB_28'); assert.equal(page.adding.value, true);
  pending.resolve({}); await saving;
  page.beginCreate(); page.pickDate({ detail: { value: '2028-02-29' } }); page.pickRecurrence('ONCE'); page.pickLeapPolicy('SKIP');
  assert.equal(page.anniversaryDate.value, '2028-02-29'); assert.equal(page.recurrence.value, 'ONCE'); assert.equal(page.leapPolicy.value, 'SKIP');
});
