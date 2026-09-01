import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccessService } from '../access/access.service';
import { PrismaService } from '../prisma/prisma.service';
import { serializable } from '../prisma/serializable';
import { compareRequirements, decimal, loadMeal, menuSnapshot } from '../meals/meal-requirements';
import { ImportShortagesDto } from './dto/import-shortages.dto';
import { CreateShoppingItemDto } from './dto/create-shopping-item.dto';
import { UpdateShoppingItemDto } from './dto/update-shopping-item.dto';
import { RepeatShoppingItemDto } from './dto/shopping-actions.dto';

@Injectable()
export class ShoppingService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService) {}

  async list(userId: string, householdId: string) {
    await this.access.require(userId, householdId, 'shopping');
    return { data: await this.prisma.shoppingList.findMany({ where: { householdId }, include: { items: { orderBy: [{ status: 'asc' }, { id: 'asc' }] } }, orderBy: { name: 'asc' } }) };
  }

  private async listFor(tx: Prisma.TransactionClient, householdId: string) {
    return tx.shoppingList.upsert({ where: { householdId_systemKey: { householdId, systemKey: 'NEXT_TRIP' } }, update: {}, create: { householdId, systemKey: 'NEXT_TRIP', name: '下次超市' } });
  }

  async createItem(userId: string, householdId: string, dto: CreateShoppingItemDto) {
    return serializable(this.prisma, async tx => {
      await this.access.require(userId, householdId, 'shopping', 'EDIT', tx);
      const list = await this.listFor(tx, householdId);
      return { data: await tx.shoppingItem.create({ data: { listId: list.id, name: dto.name, quantity: dto.quantity, unit: dto.unit, sourceType: 'MANUAL', status: dto.status ?? 'NEXT_TRIP' } }) };
    });
  }

  async updateItem(userId: string, householdId: string, itemId: string, dto: UpdateShoppingItemDto) {
    return serializable(this.prisma, async tx => {
      const member = await this.access.require(userId, householdId, 'shopping', 'EDIT', tx);
      const item = await tx.shoppingItem.findFirst({ where: { id: itemId, list: { householdId } } });
      if (!item) throw new NotFoundException('购物项不存在');
      if (item.version !== dto.expectedVersion) {
        if (item.status === dto.status && item.version === dto.expectedVersion + 1) return { data: item };
        throw new ConflictException('购物项已更新，请刷新');
      }
      if (item.status === dto.status) return { data: item };
      const updated = await tx.shoppingItem.update({ where: { id: itemId }, data: { status: dto.status, version: { increment: 1 },
        purchasedAt: dto.status === 'PURCHASED' ? new Date() : null, purchasedById: dto.status === 'PURCHASED' ? member.id : null } });
      await tx.auditLog.create({ data: { householdId, actorMembershipId: member.id, action: 'SHOPPING_STATUS', targetId: itemId,
        details: { from: item.status, to: dto.status, oldPurchasedAt: item.purchasedAt?.toISOString() ?? null, oldPurchasedById: item.purchasedById, purchasedAt: updated.purchasedAt?.toISOString() ?? null, version: updated.version } } });
      return { data: updated };
    });
  }

  async repeat(userId: string, householdId: string, itemId: string, dto: RepeatShoppingItemDto) {
    return serializable(this.prisma, async tx => {
      await this.access.require(userId, householdId, 'shopping', 'EDIT', tx);
      const item = await tx.shoppingItem.findFirst({ where: { id: itemId, list: { householdId } } });
      if (!item) throw new NotFoundException('购物项不存在');
      if (item.status !== 'PURCHASED') throw new ConflictException('只有已购买的记录可以复购');
      const key = { listId: item.listId, sourceType: 'REPEAT', sourceId: item.id, sourceVersion: 1, sourceItemKey: dto.requestId };
      return { data: await tx.shoppingItem.upsert({ where: { listId_sourceType_sourceId_sourceVersion_sourceItemKey: key }, update: {}, create: {
        ...key, previousItemId: item.id, name: item.name, quantity: item.quantity, unit: item.unit, status: 'NEXT_TRIP',
      } }) };
    });
  }

  async importShortages(userId: string, householdId: string, dto: ImportShortagesDto) {
    return serializable(this.prisma, async tx => {
      await this.access.require(userId, householdId, 'shopping', 'EDIT', tx);
      await this.access.require(userId, householdId, 'meals', 'VIEW', tx);
      await this.access.require(userId, householdId, 'inventory', 'VIEW', tx);
      const meal = await loadMeal(tx, householdId, dto.mealId);
      if (!['CONFIRMED', 'COOKING'].includes(meal.status) || meal.snapshotVersion !== dto.snapshotVersion) throw new ConflictException('请先确认当前餐单，旧快照或已完成餐单不能导入');
      const snapshot = await menuSnapshot(tx, meal);
      if (!snapshot) throw new ConflictException('餐单快照不存在');
      const comparison = await compareRequirements(tx, householdId, snapshot);
      const list = await this.listFor(tx, householdId);
      const result = [];
      for (const key of dto.selectedRequirementIds) {
        const source = { listId: list.id, sourceType: 'MEAL_SHORTAGE', sourceId: meal.id, sourceVersion: dto.snapshotVersion, sourceItemKey: key };
        const entry = comparison.find(c => c.key === key);
        if (!entry || entry.kind !== 'FOOD') throw new BadRequestException('只能选择本餐单的食材需求');
        const existing = await tx.shoppingItem.findUnique({ where: { listId_sourceType_sourceId_sourceVersion_sourceItemKey: source } });
        // Retries keep the original record, including purchased records; never overwrite history.
        if (existing) { result.push(existing); continue; }
        if (entry.status !== 'SHORTAGE' || entry.shortage === null || decimal(entry.shortage).lte(0)) throw new ConflictException('该项已不再确定缺少，请刷新库存对照');
        result.push(await tx.shoppingItem.create({ data: { ...source, name: entry.name, unit: entry.unit, quantity: entry.shortage } }));
      }
      return { data: { list, items: result } };
    });
  }

}
