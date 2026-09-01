import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const mealInclude = {
  items: { include: { recipe: { include: { category: true, ingredients: { include: { ingredient: true } }, seasonings: true } } } },
  dishes: true,
  snapshots: { orderBy: { version: 'desc' as const }, take: 1 },
} satisfies Prisma.MealInclude;
export type LoadedMeal = Prisma.MealGetPayload<{ include: typeof mealInclude }>;
export type Requirement = { key: string; ingredientId: string; name: string; unit: string; required: string | null };
export type MenuDish = {
  recipeId: string; cookMultiplier: string; wantedBy: Array<{ membershipId: string; nickname: string | null }>;
  recipe: { id: string; name: string; coverObjectKey: string | null; steps: Prisma.JsonValue;
    ingredients: Array<{ ingredientId: string; quantity: string | null; unit: string; optional: boolean; ingredient: { id: string; name: string } }>;
    seasonings: Array<{ ingredientId: string | null; name: string }>; updatedAt: string };
};
export type MenuSnapshot = { dishes: MenuDish[]; requirements: Requirement[]; seasonings: Array<{ ingredientId: string | null; name: string }> };
export const decimal = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
export const quantityText = (value: Prisma.Decimal) => value.toFixed(3);
export const requirementKey = (ingredientId: string, unit: string) => JSON.stringify([ingredientId, unit]);

export async function loadMeal(db: Prisma.TransactionClient, householdId: string, id: string) {
  const meal = await db.meal.findFirst({ where: { id, householdId }, include: mealInclude });
  if (!meal) throw new NotFoundException('餐点不存在');
  return meal;
}

export async function draftSnapshot(db: Prisma.TransactionClient, meal: LoadedMeal): Promise<MenuSnapshot> {
  const members = await db.membership.findMany({ where: { householdId: meal.householdId, id: { in: meal.items.map(i => i.addedById) } }, select: { id: true, user: { select: { nickname: true } } } });
  const selected = [...new Map(meal.items.map(i => [i.recipeId, i.recipe])).values()];
  const dishes: MenuDish[] = selected.map(recipe => ({
    recipeId: recipe.id,
    cookMultiplier: quantityText(meal.dishes.find(d => d.recipeId === recipe.id)?.cookMultiplier ?? decimal(1)),
    wantedBy: meal.items.filter(i => i.recipeId === recipe.id).map(i => ({ membershipId: i.addedById, nickname: members.find(m => m.id === i.addedById)?.user.nickname ?? null })),
    recipe: { id: recipe.id, name: recipe.name, coverObjectKey: recipe.coverObjectKey, steps: recipe.steps, updatedAt: recipe.updatedAt.toISOString(),
      ingredients: recipe.ingredients.map(i => ({ ingredientId: i.ingredientId, quantity: i.quantity?.toFixed(3) ?? null, unit: i.unit, optional: i.optional, ingredient: { id: i.ingredientId, name: i.ingredient.name } })),
      seasonings: recipe.seasonings.map(s => ({ ingredientId: s.ingredientId, name: s.name })) },
  }));
  const requirements = new Map<string, Requirement>();
  for (const dish of dishes) for (const ingredient of dish.recipe.ingredients) {
    const key = requirementKey(ingredient.ingredientId, ingredient.unit);
    const current = requirements.get(key) ?? { key, ingredientId: ingredient.ingredientId, name: ingredient.ingredient.name, unit: ingredient.unit, required: '0.000' };
    current.required = current.required === null || ingredient.quantity === null ? null
      : decimal(current.required).plus(decimal(ingredient.quantity).times(dish.cookMultiplier)).toString();
    requirements.set(key, current);
  }
  return { dishes, requirements: [...requirements.values()].map(r => ({ ...r, required: r.required === null ? null : quantityText(decimal(r.required)) })), seasonings: [...new Map(dishes.flatMap(d => d.recipe.seasonings).map(s => [s.ingredientId ?? s.name, s])).values()] };
}

export async function menuSnapshot(db: Prisma.TransactionClient, meal: LoadedMeal): Promise<MenuSnapshot | null> {
  if (meal.status === 'DRAFT') return draftSnapshot(db, meal);
  return meal.snapshots.find(s => s.version === meal.snapshotVersion)?.data as MenuSnapshot | undefined ?? null;
}

export async function mealView(db: Prisma.TransactionClient, meal: LoadedMeal) {
  const snapshot = await menuSnapshot(db, meal);
  const { snapshots, dishes, completedFromVersion, ...base } = meal;
  // A confirmed meal exposes frozen recipes, never current recipe content disguised as history.
  const items = meal.status === 'DRAFT' ? meal.items : (snapshot?.dishes ?? []).flatMap(d => d.wantedBy.map(w => ({
    id: `${d.recipeId}:${w.membershipId}`, recipeId: d.recipeId, addedById: w.membershipId, recipe: d.recipe,
  })));
  return { ...base, items, menu: snapshot?.dishes ?? [], legacyWithoutSnapshot: meal.status !== 'DRAFT' && !snapshot };
}

export async function compareRequirements(db: Prisma.TransactionClient, householdId: string, snapshot: MenuSnapshot) {
  const inventory = await db.inventoryItem.findMany({ where: { householdId, ingredientId: { in: [...snapshot.requirements.map(i => i.ingredientId), ...snapshot.seasonings.flatMap(s => s.ingredientId ? [s.ingredientId] : [])] } }, include: { ingredient: true }, orderBy: { id: 'asc' } });
  const now = new Date();
  const food = snapshot.requirements.map(item => {
    const matching = inventory.filter(i => i.ingredientId === item.ingredientId && i.unit === item.unit);
    const expired = matching.some(i => i.expiresAt && i.expiresAt <= now);
    const unknown = !matching.length || matching.some(i => i.quantity === null || i.availability === 'UNKNOWN');
    const known = matching.filter(i => i.quantity !== null && i.availability !== 'UNKNOWN' && (!i.expiresAt || i.expiresAt > now));
    const amount = known.reduce((sum, i) => sum.plus(i.quantity!), decimal(0));
    const status = expired ? 'NEEDS_CHECK' : unknown || item.required === null ? 'UNKNOWN' : amount.gte(item.required) ? 'SUFFICIENT' : 'SHORTAGE';
    return { ...item, kind: 'FOOD', status, onHand: expired || unknown ? null : quantityText(amount),
      shortage: status === 'UNKNOWN' || status === 'NEEDS_CHECK' ? null : quantityText(Prisma.Decimal.max(decimal(item.required!).minus(amount), 0)),
      reason: expired ? '存在已过期批次，请人工核实' : !matching.length ? '未登记同单位库存，不作单位换算' : unknown ? '库存数量或有无待确认' : item.required === null ? '菜谱用量未填写' : '同食材同单位比较',
      batches: matching.map(i => ({ id: i.id, version: i.version, quantity: i.quantity?.toFixed(3) ?? null, location: i.location, expiresAt: i.expiresAt, availability: i.availability })),
    };
  });
  const seasonings = snapshot.seasonings.map(s => {
    const matching = inventory.filter(i => i.ingredientId === s.ingredientId && i.ingredient.kind === 'SEASONING');
    const expired = matching.some(i => i.expiresAt && i.expiresAt <= now);
    const status = expired ? 'NEEDS_CHECK' : matching.some(i => i.availability === 'PRESENT') ? 'PRESENT'
      : !matching.length || matching.some(i => i.availability === 'UNKNOWN') ? 'UNKNOWN' : 'ABSENT';
    return { key: requirementKey(s.ingredientId ?? s.name, ''), ingredientId: s.ingredientId, name: s.name, kind: 'SEASONING', unit: '', required: null, onHand: null, shortage: null, status,
      reason: '调料仅辅助比对有无，不计算或扣减用量', batches: [] };
  });
  return [...food, ...seasonings];
}

export function expectedMealVersion(meal: { version: number }, expected: number) {
  if (meal.version !== expected) throw new ConflictException('餐单已被家人更新，请刷新后重试');
}
