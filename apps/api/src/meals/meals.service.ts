import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccessService } from '../access/access.service';
import { PrismaService } from '../prisma/prisma.service';
import { serializable } from '../prisma/serializable';
import { AddMealItemDto } from './dto/add-meal-item.dto';
import { CreateMealDto } from './dto/create-meal.dto';
import { CompleteMealDto } from './dto/complete-meal.dto';
import { ListMealsDto } from './dto/list-meals.dto';
import { MealVersionDto, ReopenMealDto, UpdateDishDto } from './dto/meal-workflow.dto';
import { compareRequirements, draftSnapshot, expectedMealVersion, loadMeal, mealInclude, mealView, menuSnapshot } from './meal-requirements';

@Injectable()
export class MealsService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService) {}

  async list(userId: string, householdId: string, query: ListMealsDto) {
    await this.access.require(userId, householdId, 'meals');
    const from = new Date(query.from), to = new Date(query.to);
    if (Number.isNaN(+from) || Number.isNaN(+to) || from >= to || +to - +from > 370 * 86400000) throw new BadRequestException('餐点查询日期范围无效');
    const meals = await this.prisma.meal.findMany({ where: { householdId, scheduledAt: { gte: from, lt: to } }, include: mealInclude, orderBy: { scheduledAt: 'asc' } });
    return { data: await Promise.all(meals.map(m => mealView(this.prisma, m))) };
  }

  async create(userId: string, householdId: string, dto: CreateMealDto) {
    return serializable(this.prisma, async tx => {
      await this.access.require(userId, householdId, 'meals', 'EDIT', tx);
      const scheduledAt = new Date(dto.scheduledAt);
      if (Number.isNaN(+scheduledAt)) throw new BadRequestException('餐点时间无效');
      const localDate = new Date(+scheduledAt + 8 * 3600000).toISOString().slice(0, 10);
      if (dto.localDate && dto.localDate !== localDate) throw new BadRequestException('餐点日期与北京时间不一致');
      const mealType = ({ 早餐: 'BREAKFAST', 午餐: 'LUNCH', 晚餐: 'DINNER', 加餐: 'OTHER' } as Record<string, string>)[dto.mealType] ?? dto.mealType;
      if (dto.slotKey && mealType !== 'OTHER') throw new BadRequestException('仅加餐可以指定额外餐次');
      const key = { householdId, localDate, mealType, slotKey: dto.slotKey ?? '' };
      const meal = await tx.meal.upsert({ where: { householdId_localDate_mealType_slotKey: key }, create: { ...key, scheduledAt }, update: {}, include: mealInclude });
      return { data: await mealView(tx, meal) };
    });
  }

  async addItem(userId: string, householdId: string, mealId: string, dto: AddMealItemDto) {
    return serializable(this.prisma, async tx => {
      const member = await this.access.require(userId, householdId, 'meals', 'EDIT', tx);
      await this.access.require(userId, householdId, 'recipes', 'VIEW', tx);
      const meal = await loadMeal(tx, householdId, mealId);
      if (meal.status !== 'DRAFT') throw new ConflictException('餐单已经确认，需由厨师重新打开后才能点菜');
      const recipe = await tx.recipe.findFirst({ where: { id: dto.recipeId, householdId, status: 'PUBLISHED' } });
      if (!recipe) throw new BadRequestException('只能选择本家庭已发布的菜谱');
      const existing = meal.items.find(i => i.recipeId === recipe.id && i.addedById === member.id);
      if (existing && existing.note === (dto.note ?? null)) return { data: existing };
      const item = await tx.mealItem.upsert({ where: { mealId_recipeId_addedById: { mealId, recipeId: recipe.id, addedById: member.id } }, update: { note: dto.note ?? null }, create: { mealId, recipeId: recipe.id, addedById: member.id, note: dto.note }, include: { recipe: true } });
      await tx.mealDish.upsert({ where: { mealId_recipeId: { mealId, recipeId: recipe.id } }, create: { mealId, recipeId: recipe.id }, update: {} });
      await tx.meal.update({ where: { id: mealId }, data: { version: { increment: 1 } } });
      return { data: item };
    });
  }

  async removeItem(userId: string, householdId: string, mealId: string, recipeId: string) {
    return serializable(this.prisma, async tx => {
      const member = await this.access.require(userId, householdId, 'meals', 'EDIT', tx);
      const meal = await loadMeal(tx, householdId, mealId);
      if (meal.status !== 'DRAFT') throw new ConflictException('只能撤回草稿餐单中本人想吃的菜');
      const result = await tx.mealItem.deleteMany({ where: { mealId, recipeId, addedById: member.id } });
      if (result.count) {
        if (!await tx.mealItem.count({ where: { mealId, recipeId } })) await tx.mealDish.deleteMany({ where: { mealId, recipeId } });
        await tx.meal.update({ where: { id: mealId }, data: { version: { increment: 1 } } });
      }
      return { data: { removed: !!result.count } };
    });
  }

  async updateDish(userId: string, householdId: string, mealId: string, recipeId: string, dto: UpdateDishDto) {
    return serializable(this.prisma, async tx => {
      const member = await this.access.require(userId, householdId, 'meals', 'MANAGE', tx);
      const meal = await loadMeal(tx, householdId, mealId); expectedMealVersion(meal, dto.expectedVersion);
      if (meal.status !== 'DRAFT') throw new ConflictException('请先重新打开餐单，调整后再次确认以保留新旧快照');
      if (!meal.items.some(i => i.recipeId === recipeId)) throw new BadRequestException('菜品不在本餐单中');
      await tx.mealDish.upsert({ where: { mealId_recipeId: { mealId, recipeId } }, create: { mealId, recipeId, cookMultiplier: dto.cookMultiplier }, update: { cookMultiplier: dto.cookMultiplier } });
      await tx.meal.update({ where: { id: mealId }, data: { version: { increment: 1 } } });
      await tx.auditLog.create({ data: { householdId, actorMembershipId: member.id, action: 'MEAL_SERVINGS', targetId: mealId, details: { recipeId, before: meal.dishes.find(d => d.recipeId === recipeId)?.cookMultiplier.toString() ?? '1', after: String(dto.cookMultiplier) } } });
      return { data: await mealView(tx, await loadMeal(tx, householdId, mealId)) };
    });
  }

  async transition(userId: string, householdId: string, mealId: string, action: 'confirm' | 'reopen' | 'start' | 'cancel', dto: MealVersionDto | ReopenMealDto) {
    return serializable(this.prisma, async tx => {
      const member = await this.access.require(userId, householdId, 'meals', 'MANAGE', tx);
      const meal = await loadMeal(tx, householdId, mealId); expectedMealVersion(meal, dto.expectedVersion);
      let status = meal.status, snapshotVersion = meal.snapshotVersion;
      if (action === 'confirm') {
        if (meal.status !== 'DRAFT' || !meal.items.length) throw new ConflictException('只有非空草稿餐单可以确认');
        if (meal.items.some(i => i.recipe.status !== 'PUBLISHED')) throw new ConflictException('有菜谱已下架，请先调整餐单');
        const snapshot = await draftSnapshot(tx, meal); snapshotVersion++;
        await tx.mealSnapshot.create({ data: { mealId, version: snapshotVersion, createdById: member.id, data: snapshot as unknown as Prisma.InputJsonValue } });
        status = 'CONFIRMED';
      } else if (action === 'reopen') {
        if (meal.status !== 'CONFIRMED') throw new ConflictException('只有已确认、尚未烹饪的餐单可以重新打开');
        status = 'DRAFT';
      } else if (action === 'start') {
        if (meal.status !== 'CONFIRMED' || !meal.snapshotVersion) throw new ConflictException('请先确认餐单快照');
        status = 'COOKING';
      } else {
        if (!['DRAFT', 'CONFIRMED', 'COOKING'].includes(meal.status)) throw new ConflictException('当前状态不能取消');
        status = 'CANCELLED';
      }
      await tx.meal.update({ where: { id: mealId }, data: { status, snapshotVersion, version: { increment: 1 } } });
      await tx.auditLog.create({ data: { householdId, actorMembershipId: member.id, action: 'MEAL_' + action.toUpperCase(), targetId: mealId,
        details: { from: meal.status, to: status, beforeSnapshotVersion: meal.snapshotVersion, snapshotVersion, reason: 'reason' in dto ? dto.reason : null } } });
      return { data: await mealView(tx, await loadMeal(tx, householdId, mealId)) };
    });
  }

  async snapshots(userId: string, householdId: string, mealId: string) {
    await this.access.require(userId, householdId, 'meals');
    await loadMeal(this.prisma, householdId, mealId);
    return { data: await this.prisma.mealSnapshot.findMany({ where: { mealId }, orderBy: { version: 'desc' } }) };
  }

  async recalculate(userId: string, householdId: string, mealId: string, snapshotVersion?: number) {
    return serializable(this.prisma, async tx => {
      await this.access.require(userId, householdId, 'meals', 'VIEW', tx);
      await this.access.require(userId, householdId, 'inventory', 'VIEW', tx);
      const meal = await loadMeal(tx, householdId, mealId);
      if (snapshotVersion !== undefined && (meal.status === 'DRAFT' || meal.snapshotVersion !== snapshotVersion)) throw new ConflictException('菜单快照已变化，请刷新');
      const snapshot = await menuSnapshot(tx, meal);
      if (!snapshot) throw new ConflictException('旧餐单没有确认快照，不能声称已还原历史用料');
      return { data: await compareRequirements(tx, householdId, snapshot) };
    });
  }

  async complete(userId: string, householdId: string, mealId: string, dto: CompleteMealDto) {
    return serializable(this.prisma, async tx => {
      const member = await this.access.require(userId, householdId, 'meals', 'MANAGE', tx);
      const meal = await loadMeal(tx, householdId, mealId);
      if (meal.status === 'COMPLETED') {
        if (meal.completedFromVersion !== dto.expectedVersion) throw new ConflictException('餐点已经由其他操作完成，请刷新');
        return { data: await mealView(tx, meal) };
      }
      expectedMealVersion(meal, dto.expectedVersion);
      if (!['CONFIRMED', 'COOKING'].includes(meal.status)) throw new ConflictException('请先确认餐单再完成用餐');
      if (!await menuSnapshot(tx, meal)) throw new ConflictException('缺少餐单快照');
      await tx.meal.update({ where: { id: mealId }, data: { status: 'COMPLETED', version: { increment: 1 }, completedAt: new Date(), completedFromVersion: dto.expectedVersion } });
      await tx.auditLog.create({ data: { householdId, actorMembershipId: member.id, action: 'MEAL_COMPLETE', targetId: mealId,
        details: { snapshotVersion: meal.snapshotVersion, inventoryChanged: false, reason: '一期库存仅人工维护' } } });
      return { data: await mealView(tx, await loadMeal(tx, householdId, mealId)) };
    });
  }
}
