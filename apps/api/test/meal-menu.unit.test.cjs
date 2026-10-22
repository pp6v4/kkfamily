require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ForbiddenException, RequestMethod, ValidationPipe } = require('@nestjs/common');
const { METHOD_METADATA, PATH_METADATA } = require('@nestjs/common/constants');
const { Prisma } = require('@prisma/client');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { MealsService } = require('../src/meals/meals.service.ts');
const { MealsController } = require('../src/meals/meals.controller.ts');
const { MealVersionDto } = require('../src/meals/dto/meal-workflow.dto.ts');

function copy(value) {
  if (value instanceof Date) return new Date(value);
  if (value instanceof Prisma.Decimal) return new Prisma.Decimal(value);
  if (Array.isArray(value)) return value.map(copy);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]));
  return value;
}
function fixture({ status = 'DRAFT', denied = false, auditFailure = false } = {}) {
  const recipe = id => ({ id, name: id === 'recipe-a' ? '已下架的菜' : '保留的菜', status: id === 'recipe-a' ? 'ARCHIVED' : 'PUBLISHED', coverObjectKey: null, steps: ['做熟'], ingredients: [], seasonings: [], updatedAt: new Date('2026-09-01T00:00:00Z') });
  let state = {
    meal: { id: 'meal-a', householdId: 'house-a', version: 4, snapshotVersion: 1, status, mealType: 'DINNER', localDate: '2026-09-01', slotKey: '', scheduledAt: new Date('2026-09-01T10:00:00Z') },
    items: [{ id: 'vote-b', mealId: 'meal-a', recipeId: 'recipe-a', addedById: 'member-b', note: '少盐', recipe: recipe('recipe-a') }, { id: 'vote-c', mealId: 'meal-a', recipeId: 'recipe-a', addedById: 'member-c', note: null, recipe: recipe('recipe-a') }, { id: 'vote-other', mealId: 'meal-a', recipeId: 'recipe-b', addedById: 'member-b', note: null, recipe: recipe('recipe-b') }],
    dishes: [{ mealId: 'meal-a', recipeId: 'recipe-a', cookMultiplier: new Prisma.Decimal('2.125') }, { mealId: 'meal-a', recipeId: 'recipe-b', cookMultiplier: new Prisma.Decimal(1) }],
    snapshots: [{ id: 'snapshot-a', version: 1, data: { immutable: '此前已确认的菜单', dishes: [] } }],
    audits: [], inventory: [{ id: 'stock-a', quantity: '100.000' }],
  };
  const writes = [], accessCalls = [], reads = [], isolation = [];
  const matches = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
  const tx = {
    meal: {
      findFirst: async input => { reads.push(input.where); return matches(state.meal, input.where) ? copy({ ...state.meal, items: state.items, dishes: state.dishes, snapshots: state.snapshots }) : null; },
      update: async input => { writes.push(['meal', input]); state.meal.version += input.data.version.increment; return copy(state.meal); },
    },
    mealItem: {
      deleteMany: async input => { writes.push(['items', input]); const before = state.items.length; state.items = state.items.filter(row => !matches(row, input.where)); return { count: before - state.items.length }; },
      count: async input => state.items.filter(row => matches(row, input.where)).length,
    },
    mealDish: { deleteMany: async input => { writes.push(['dish', input]); const before = state.dishes.length; state.dishes = state.dishes.filter(row => !matches(row, input.where)); return { count: before - state.dishes.length }; } },
    membership: { findMany: async () => [{ id: 'member-b', user: { nickname: '家人' } }] },
    auditLog: { create: async input => { writes.push(['audit', input]); if (auditFailure) throw new Error('audit failed'); state.audits.push(copy(input.data)); return copy(input.data); } },
  };
  const prisma = { $transaction: async (callback, options) => { isolation.push(options.isolationLevel); const before = copy(state); try { return await callback(tx); } catch (error) { state = before; throw error; } } };
  const access = { require: async (...args) => { accessCalls.push(args.slice(0, 4)); assert.equal(args[4], tx); if (denied) throw new ForbiddenException(); return { id: 'manager-a' }; } };
  return { service: new MealsService(prisma, access), get state() { return state; }, writes, reads, accessCalls, isolation };
}

test('R01 manager removes every vote for an archived dish, preserves other dishes and immutable snapshots, and audits each removed choice', async () => {
  const f = fixture(), snapshots = copy(f.state.snapshots), stock = copy(f.state.inventory);
  const result = await f.service.removeDish('user-a', 'house-a', 'meal-a', 'recipe-a', { expectedVersion: 4 });
  assert.equal(result.data.version, 5); assert.equal(result.data.snapshotVersion, 1);
  assert.deepEqual(result.data.menu.map(item => item.recipeId), ['recipe-b']);
  assert.deepEqual(f.state.items.map(item => item.id), ['vote-other']); assert.deepEqual(f.state.dishes.map(item => item.recipeId), ['recipe-b']);
  assert.deepEqual(f.state.snapshots, snapshots); assert.deepEqual(f.state.inventory, stock);
  assert.deepEqual(f.accessCalls, [['user-a', 'house-a', 'meals', 'MANAGE']]); assert.deepEqual(f.isolation, ['Serializable']);
  assert.ok(f.reads.every(where => where.id === 'meal-a' && where.householdId === 'house-a'));
  assert.deepEqual(f.state.audits, [{ householdId: 'house-a', actorMembershipId: 'manager-a', action: 'MEAL_DISH_REMOVE', targetId: 'meal-a', details: {
    fromVersion: 4, toVersion: 5, snapshotVersion: 1, recipeId: 'recipe-a', recipeName: '已下架的菜', cookMultiplier: '2.125',
    removedSelections: [{ id: 'vote-b', addedById: 'member-b', note: '少盐' }, { id: 'vote-c', addedById: 'member-c', note: null }],
  } }]);
});

test('R01 ordinary editors and confirmed/cooking/completed/cancelled meals cannot use manager removal', async () => {
  const denied = fixture({ denied: true }); await assert.rejects(denied.service.removeDish('user-a', 'house-a', 'meal-a', 'recipe-a', { expectedVersion: 4 }), error => error.getStatus() === 403);
  assert.deepEqual(denied.writes, []); assert.deepEqual(denied.reads, []);
  for (const status of ['CONFIRMED', 'COOKING', 'COMPLETED', 'CANCELLED']) {
    const f = fixture({ status }), before = copy(f.state);
    await assert.rejects(f.service.removeDish('user-a', 'house-a', 'meal-a', 'recipe-a', { expectedVersion: 4 }), error => error.getStatus() === 409);
    assert.deepEqual(f.writes, []); assert.deepEqual(f.state, before);
  }
});

test('R01 stale versions, absent dishes and other households produce no writes; audit failure rolls back the whole removal', async () => {
  for (const [household, recipeId, version, status] of [['house-a', 'recipe-a', 3, 409], ['house-a', 'missing', 4, 400], ['house-other', 'recipe-a', 4, 404]]) {
    const f = fixture(), before = copy(f.state);
    await assert.rejects(f.service.removeDish('user-a', household, 'meal-a', recipeId, { expectedVersion: version }), error => error.getStatus() === status);
    assert.deepEqual(f.writes, []); assert.deepEqual(f.state, before);
  }
  const failed = fixture({ auditFailure: true }), before = copy(failed.state);
  await assert.rejects(failed.service.removeDish('user-a', 'house-a', 'meal-a', 'recipe-a', { expectedVersion: 4 }), /audit failed/);
  assert.deepEqual(failed.state, before); assert.deepEqual(failed.isolation, ['Serializable']);
});

test('Ordinary withdrawal still removes only the caller choice and preserves everyone else', async () => {
  const f = fixture(); f.state.items.push({ ...copy(f.state.items[0]), id: 'own-vote', addedById: 'manager-a' });
  await f.service.removeItem('user-a', 'house-a', 'meal-a', 'recipe-a');
  assert.deepEqual(f.state.items.map(item => item.id), ['vote-b', 'vote-c', 'vote-other']); assert.equal(f.state.dishes.length, 2);
  assert.deepEqual(f.accessCalls, [['user-a', 'house-a', 'meals', 'EDIT']]); assert.equal(f.state.meal.version, 5);
});

test('R01 explicit removal route forwards actor, household, dish and validated version without a database', async () => {
  const handler = MealsController.prototype.removeDish, calls = [];
  assert.equal(Reflect.getMetadata(PATH_METADATA, handler), ':id/dishes/:recipeId/remove'); assert.equal(Reflect.getMetadata(METHOD_METADATA, handler), RequestMethod.POST);
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const validate = input => pipe.transform(input, { type: 'body', metatype: MealVersionDto });
  for (const input of [{}, { expectedVersion: 0 }, { expectedVersion: 4.1 }, { expectedVersion: '4' }, { expectedVersion: 4, addedById: 'other' }]) await assert.rejects(validate(input), error => error.getStatus() === 400);
  const dto = await validate({ expectedVersion: 4 });
  const controller = new MealsController({ removeDish: async (...args) => { calls.push(args); return { data: { version: 5 } }; } });
  assert.deepEqual(await controller.removeDish({ userId: 'user-a' }, 'house-a', 'meal-a', 'recipe-a', dto), { data: { version: 5 } });
  assert.deepEqual(calls, [['user-a', 'house-a', 'meal-a', 'recipe-a', dto]]);
});
