import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MealStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AddMealItemDto } from './dto/add-meal-item.dto';
import { CreateMealDto } from './dto/create-meal.dto';
import { ListMealsDto } from './dto/list-meals.dto';

@Injectable()
export class MealsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, householdId: string, query: ListMealsDto) {
    await this.requireMember(userId, householdId);
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (Number.isNaN(from.valueOf()) || Number.isNaN(to.valueOf()) || from >= to) throw new BadRequestException('Invalid meal range');
    return { data: await this.prisma.meal.findMany({
      where: { householdId, scheduledAt: { gte: from, lt: to } },
      include: { items: { include: { recipe: { include: { ingredients: { include: { ingredient: true } } } } } } },
      orderBy: { scheduledAt: 'asc' },
    }) };
  }

  async create(userId: string, householdId: string, dto: CreateMealDto) {
    await this.requireMember(userId, householdId);
    const scheduledAt = new Date(dto.scheduledAt);
    if (Number.isNaN(scheduledAt.valueOf())) throw new BadRequestException('Invalid meal time');
    return { data: await this.prisma.meal.create({ data: { householdId, scheduledAt, mealType: dto.mealType.trim() } }) };
  }

  async addItem(userId: string, householdId: string, mealId: string, dto: AddMealItemDto) {
    const membership = await this.requireMember(userId, householdId);
    const meal = await this.prisma.meal.findFirst({ where: { id: mealId, householdId } });
    if (!meal) throw new NotFoundException('Meal was not found');
    if (meal.status !== MealStatus.DRAFT) throw new BadRequestException('Only draft meals can be changed');
    const recipe = await this.prisma.recipe.findFirst({ where: { id: dto.recipeId, householdId, status: 'PUBLISHED' } });
    if (!recipe) throw new NotFoundException('Published recipe was not found');
    return { data: await this.prisma.mealItem.upsert({
      where: { mealId_recipeId_addedById: { mealId, recipeId: recipe.id, addedById: membership.id } },
      update: { note: dto.note?.trim() },
      create: { mealId, recipeId: recipe.id, addedById: membership.id, note: dto.note?.trim() },
      include: { recipe: true },
    }) };
  }

  async recalculate(userId: string, householdId: string, mealId: string) {
    await this.requireMember(userId, householdId);
    const meal = await this.prisma.meal.findFirst({
      where: { id: mealId, householdId },
      include: { items: { include: { recipe: { include: { ingredients: true } } } } },
    });
    if (!meal) throw new NotFoundException('Meal was not found');
    const items = new Map<string, { ingredientId: string; unit: string; required: number; hasUnknownQuantity: boolean }>();
    for (const mealItem of meal.items) {
      for (const ingredient of mealItem.recipe.ingredients) {
        const key = ingredient.ingredientId + ':' + ingredient.unit;
        const summary = items.get(key) ?? { ingredientId: ingredient.ingredientId, unit: ingredient.unit, required: 0, hasUnknownQuantity: false };
        if (ingredient.quantity === null) summary.hasUnknownQuantity = true;
        else summary.required += Number(ingredient.quantity);
        items.set(key, summary);
      }
    }
    const inventory = await this.prisma.inventoryItem.findMany({ where: { householdId, ingredientId: { in: [...items.values()].map((item) => item.ingredientId) } }, include: { ingredient: true } });
    const stock = new Map<string, number>();
    for (const item of inventory) {
      const key = item.ingredientId + ':' + item.unit;
      stock.set(key, (stock.get(key) ?? 0) + Number(item.quantity));
    }
    return {
      data: await Promise.all([...items.values()].map(async (item) => {
        const ingredient = await this.prisma.ingredient.findUnique({ where: { id: item.ingredientId } });
        const onHand = stock.get(item.ingredientId + ':' + item.unit);
        const status = item.hasUnknownQuantity || onHand === undefined ? 'UNKNOWN' : onHand >= item.required ? 'SUFFICIENT' : 'SHORTAGE';
        return { ingredientId: item.ingredientId, name: ingredient?.name ?? 'Unknown', unit: item.unit, required: item.hasUnknownQuantity ? null : item.required, onHand: onHand ?? null, shortage: item.hasUnknownQuantity || onHand === undefined ? null : Math.max(item.required - onHand, 0), status };
      })),
    };
  }

  private async requireMember(userId: string, householdId: string) {
    const membership = await this.prisma.membership.findFirst({ where: { householdId, userId, status: 'ACTIVE' } });
    if (!membership) throw new ForbiddenException('No access to this household');
    return membership;
  }
}
