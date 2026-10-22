const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('vue/compiler-sfc');

const ROOT = path.resolve(__dirname, '..');
function dashboard(now) {
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return Date.parse(now); }
  }
  function evaluate(source, dependencies) {
    const module = { exports: {} };
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, Date: FixedDate, require: name => {
      if (name in dependencies) return dependencies[name];
      throw new Error('Unexpected dependency: ' + name);
    }, uni: { showToast() {} } });
    return module.exports;
  }
  const travel = evaluate(fs.readFileSync(path.join(ROOT, 'src/services/trip-form.ts'), 'utf8'), {});
  const calendar = evaluate(fs.readFileSync(path.join(ROOT, 'src/services/calendar-dates.ts'), 'utf8'), { './trip-form': travel });
  const requests = [], lifecycle = {};
  const context = { effectivePermissions: { dashboard: 'VIEW' } };
  const filename = path.join(ROOT, 'src/pages/dashboard/index.vue');
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename });
  const page = evaluate(compileScript(descriptor, { id: 'dashboard-range-test', inlineTemplate: false }).content, {
    vue,
    '@dcloudio/uni-app': { onShow: fn => lifecycle.show = fn, onHide() {}, onUnload() {} },
    '../../services/calendar-dates': calendar,
    '../../services/session': { refreshAccess: async () => context, canAccess: (member, module) => Boolean(member?.effectivePermissions?.[module]) },
    '../../services/family-api': { getDashboardSummary: async (from, to) => { requests.push({ from, to }); return { from, to }; } },
  }).default.setup({}, { expose() {} });
  return { page, lifecycle, requests };
}

async function inTimezones(check) {
  const original = process.env.TZ;
  try {
    for (const timezone of ['Asia/Shanghai', 'UTC', 'America/New_York']) {
      process.env.TZ = timezone;
      await check(timezone);
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

test('Dashboard sends the same Shanghai date boundaries for 30, 90 and 365 days in every device timezone', async () => {
  await inTimezones(async timezone => {
    const { page, lifecycle, requests } = dashboard('2026-10-21T15:30:00Z');
    const expectedStarts = ['2026-09-21T16:00:00.000Z', '2026-07-23T16:00:00.000Z', '2025-10-21T16:00:00.000Z'];
    for (let index = 0; index < expectedStarts.length; index++) {
      page.rangeIndex.value = index;
      await lifecycle.show();
      assert.deepEqual(requests[index], { from: expectedStarts[index], to: '2026-10-21T16:00:00.000Z' }, timezone);
      assert.equal(page.summary.value.from, expectedStarts[index]);
    }
  });
});

test('Dashboard advances its inclusive current day at Shanghai midnight rather than device midnight', async () => {
  await inTimezones(async timezone => {
    const before = dashboard('2026-10-21T15:59:59Z'), after = dashboard('2026-10-21T16:00:00Z');
    await before.lifecycle.show(); await after.lifecycle.show();
    assert.deepEqual(before.requests[0], { from: '2026-09-21T16:00:00.000Z', to: '2026-10-21T16:00:00.000Z' }, timezone);
    assert.deepEqual(after.requests[0], { from: '2026-09-22T16:00:00.000Z', to: '2026-10-22T16:00:00.000Z' }, timezone);
  });
});

test('Dashboard keeps 30 Shanghai days when the device timezone crosses daylight saving time', async () => {
  await inTimezones(async timezone => {
    const { lifecycle, requests } = dashboard('2026-11-10T12:00:00Z');
    await lifecycle.show();
    assert.deepEqual(requests[0], { from: '2026-10-11T16:00:00.000Z', to: '2026-11-10T16:00:00.000Z' }, timezone);
    assert.equal(Date.parse(requests[0].to) - Date.parse(requests[0].from), 30 * 86_400_000);
  });
});

test('Dashboard retains a fixed 365-day year range across a Shanghai leap day', async () => {
  await inTimezones(async timezone => {
    const { page, lifecycle, requests } = dashboard('2028-02-28T16:00:00Z');
    page.rangeIndex.value = 2;
    await lifecycle.show();
    assert.deepEqual(requests[0], { from: '2027-03-01T16:00:00.000Z', to: '2028-02-29T16:00:00.000Z' }, timezone);
  });
});
