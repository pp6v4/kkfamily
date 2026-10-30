const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const identity = { householdId: 'house-a', membershipId: 'member-a' };
const input = () => ({ id: '', version: 0, status: 'DRAFT', name: ' 未填完 ', categoryId: 'category-a', originalCategoryId: null,
  coverAssetId: '', ingredients: [{ name: '鸡蛋', quantity: '', unit: '个' }], seasonings: [''], steps: [''] });
const plain = value => JSON.parse(JSON.stringify(value));
function store(options = {}) {
  const data = new Map(), module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/services/recipe-draft.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Error, uni: {
    getStorageSync: key => data.get(key),
    setStorageSync: (key, value) => { if (options.fail) throw Error('full'); data.set(key, value); },
    removeStorageSync: key => data.delete(key),
  } });
  return { ...module.exports, data };
}
test('Local recipe draft stores only editable fields, preserving incomplete text and exact quantity strings', () => {
  const s = store(), fields = input(); fields.accessToken = 'must-not-persist'; fields.coverPreview = '/signed-secret';
  fields.ingredients[0].quantity = '0.';
  const saved = s.writeRecipeDraft(identity, '', fields);
  const loaded = s.readRecipeDraft(identity, ''); assert.equal(loaded.fields.name, ' 未填完 '); assert.equal(loaded.fields.ingredients[0].quantity, '0.');
  assert.doesNotMatch(JSON.stringify(saved), /must-not-persist|signed-secret|accessToken|coverPreview/);
  fields.ingredients[0].name = 'changed'; saved.fields.steps[0] = 'changed'; loaded.fields.seasonings[0] = 'changed';
  const again = s.readRecipeDraft(identity, ''); assert.equal(again.fields.ingredients[0].name, '鸡蛋'); assert.equal(again.fields.steps[0], ''); assert.equal(again.fields.seasonings[0], '');
});
test('Household, membership, new recipe, and each existing recipe have independent recovery slots', () => {
  const s = store(), a = input(); s.writeRecipeDraft(identity, '', a);
  s.writeRecipeDraft(identity, 'new', { ...a, id: 'new', name: 'existing new' });
  s.writeRecipeDraft(identity, 'recipe-b', { ...a, id: 'recipe-b', name: 'existing b' });
  s.writeRecipeDraft({ ...identity, householdId: 'other' }, '', { ...a, name: 'other household' });
  s.writeRecipeDraft({ ...identity, membershipId: 'other' }, '', { ...a, name: 'other member' });
  assert.equal(s.data.size, 5); assert.equal(s.readRecipeDraft(identity, '').fields.name, a.name);
  assert.equal(s.readRecipeDraft(identity, 'new').fields.name, 'existing new'); assert.equal(s.readRecipeDraft(identity, 'recipe-b').fields.name, 'existing b');
});
test('An old save/discard receipt never removes a newer recipe draft', () => {
  const s = store(), old = s.writeRecipeDraft(identity, '', input());
  const current = s.writeRecipeDraft(identity, '', { ...input(), name: 'new input' });
  assert.notEqual(old.revision, current.revision); assert.equal(s.removeRecipeDraft(identity, '', old.revision), false);
  assert.equal(s.readRecipeDraft(identity, '').fields.name, 'new input'); assert.equal(s.removeRecipeDraft(identity, '', current.revision), true); assert.equal(s.data.size, 0);
});
test('Mismatched or corrupt persisted records are ignored without deleting them', () => {
  const s = store(), original = s.writeRecipeDraft(identity, '', input()), key = [...s.data.keys()][0];
  for (const mutate of [x => x.schema = 2, x => x.membershipId = 'other', x => x.slotId = 'other', x => x.fields.ingredients = null,
    x => x.fields.steps = ['x'.repeat(4001)], x => x.fields.pendingCover = { tempFilePath: '/file', size: -1, mimeType: 'image/jpeg' }]) {
    const invalid = plain(original); mutate(invalid); s.data.set(key, invalid);
    assert.equal(s.readRecipeDraft(identity, ''), undefined); assert.equal(s.data.get(key), invalid);
  }
});
test('Invalid oversized or mismatched writes leave the existing valid recovery record unchanged', () => {
  const s = store(); s.writeRecipeDraft(identity, '', input()); const before = JSON.stringify([...s.data]);
  assert.throws(() => s.writeRecipeDraft(identity, '', { ...input(), name: 'x'.repeat(81) }));
  assert.throws(() => s.writeRecipeDraft(identity, 'recipe-a', { ...input(), id: 'recipe-b' }));
  assert.equal(JSON.stringify([...s.data]), before);
});
test('Storage failure propagates to the editor instead of returning a false backup receipt', () => {
  const s = store({ fail: true }); assert.throws(() => s.writeRecipeDraft(identity, '', input()), /full/); assert.equal(s.data.size, 0);
});
