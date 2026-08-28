import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ImportShortagesDto } from './dto/import-shortages.dto';
import { CreateShoppingItemDto } from './dto/create-shopping-item.dto';
import { ShoppingItemStatus } from '@prisma/client';

@Injectable()
export class ShoppingService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, householdId: string) {
    await this.requireMember(userId, householdId);
    return { data: await this.prisma.shoppingList.findMany({ where: { householdId }, include: { items: { orderBy: { status: 'asc' } } }, orderBy: { name: 'asc' } }) };
  }

  async createItem(userId: string, householdId: string, dto: CreateShoppingItemDto) {
    await this.requireMember(userId, householdId);
    const list = await this.getOrCreateNextTripList(householdId);
    return { data: await this.prisma.shoppingItem.create({
      data: { listId: list.id, name: dto.name.trim(), quantity: dto.quantity, unit: dto.unit?.trim(), sourceType: 'MANUAL', status: ShoppingItemStatus.NEXT_TRIP },
    }) };
  }

  async updateItem(userId: string, householdId: string, itemId: string, status: ShoppingItemStatus) {
    await this.requireMember(userId, householdId);
    const item = await this.prisma.shoppingItem.findFirst({ where: { id: itemId, list: { householdId } } });
    if (!item) throw new NotFoundException('Shopping item was not found');
    return { data: await this.prisma.shoppingItem.update({ where: { id: itemId }, data: { status } }) };
  }

  async importShortages(userId: string, householdId: string, dto: ImportShortagesDto) {
    await this.requireMember(userId, householdId);
    const meal = await this.prisma.meal.findFirst({ where: { id: dto.mealId, householdId } });
    if (!meal) throw new NotFoundException('Meal was not found');
    const unique = new Map<string, number>();
    for (const item of dto.items) {
      if (item.quantity <= 0) throw new BadRequestException('Shortage quantity must be positive');
      const key = item.ingredientId + ':' + item.unit;
      unique.set(key, (unique.get(key) ?? 0) + item.quantity);
    }
    const ingredientIds = [...new Set(dto.items.map((item) => item.ingredientId))];
    const ingredients = await this.prisma.ingredient.findMany({ where: { householdId, id: { in: ingredientIds } } });
    if (ingredients.length !== ingredientIds.length) throw new BadRequestException('Ingredient does not belong to this household');
    const list = await this.getOrCreateNextTripList(householdId);
    const created = await this.prisma.$transaction(async (tx) => Promise.all([...unique.entries()].map(async ([key, quantity]) => {
      const parts = key.split(':');
      const ingredientId = parts[0];
      const unit = parts.slice(1).join(':');
      const ingredient = ingredients.find((entry) => entry.id === ingredientId);
      const existing = await tx.shoppingItem.findFirst({ where: { listId: list.id, name: ingredient!.name, unit, sourceType: 'MEAL_SHORTAGE', sourceId: dto.mealId, status: { not: ShoppingItemStatus.PURCHASED } } });
      return existing
        ? tx.shoppingItem.update({ where: { id: existing.id }, data: { quantity } })
        : tx.shoppingItem.create({ data: { listId: list.id, name: ingredient!.name, quantity, unit, sourceType: 'MEAL_SHORTAGE', sourceId: dto.mealId } });
    })));
    return { data: { list, items: created } };
  }

  private async getOrCreateNextTripList(householdId: string) {
    const existing = await this.prisma.shoppingList.findFirst({ where: { householdId, name: '下次超市' } });
    return existing ?? this.prisma.shoppingList.create({ data: { householdId, name: '下次超市' } });
  }

  private async requireMember(userId: string, householdId: string) {
    const membership = await this.prisma.membership.findFirst({ where: { householdId, userId, status: 'ACTIVE' } });
    if (!membership) throw new ForbiddenException('No access to this household');
    return membership;
  }
}
