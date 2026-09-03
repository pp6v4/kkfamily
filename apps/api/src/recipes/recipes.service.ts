import { AccessService } from '../access/access.service';
import { Level, permits } from '../access/permission-policy';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RecipeStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { serializable } from '../prisma/serializable';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { UpdateRecipeDto } from './dto/update-recipe.dto';
import { UpdateRecipeStatusDto } from './dto/update-recipe-status.dto';
import { ArchiveCategoryDto, UpdateCategoryDto } from './dto/update-category.dto';

const recipeInclude = { category: true, ingredients: { include: { ingredient: true } }, seasonings: true } satisfies Prisma.RecipeInclude;

function ensureDistinctIngredients(items: Array<{ name: string }>) {
  if (new Set(items.map(i => i.name.trim())).size !== items.length) throw new BadRequestException('同一道菜的食材名称不能重复，请合并用量');
}

@Injectable()
export class RecipesService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService) {}

  async listCategories(userId: string, householdId: string) {
    await this.requireMember(userId, householdId);
    return { data: await this.prisma.recipeCategory.findMany({ where: { householdId, archivedAt: null }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }) };
  }

  async updateCategory(userId: string, householdId: string, categoryId: string, dto: UpdateCategoryDto) {
    if (dto.name === undefined && dto.sortOrder === undefined) throw new BadRequestException('请至少修改分类名称或排序');
    try {
      return await this.prisma.$transaction(async tx => {
        const membership = await this.access.require(userId, householdId, 'recipes', 'MANAGE', tx);
        const current = await tx.recipeCategory.findFirst({ where: { id: categoryId, householdId, archivedAt: null } });
        if (!current) throw new NotFoundException('菜谱分类不存在');
        const changed = await tx.recipeCategory.updateMany({ where: { id: categoryId, householdId, archivedAt: null, version: dto.expectedVersion }, data: { name: dto.name, sortOrder: dto.sortOrder, version: { increment: 1 } } });
        if (!changed.count) throw new ConflictException('菜谱分类已被其他人修改，请刷新后重试');
        const updated = await tx.recipeCategory.findUniqueOrThrow({ where: { id: categoryId } });
        await tx.auditLog.create({ data: { householdId, actorMembershipId: membership.id, action: 'RECIPE_CATEGORY_UPDATE', targetId: categoryId, details: { fromVersion: current.version, toVersion: updated.version, fromName: current.name, toName: updated.name, fromSortOrder: current.sortOrder, toSortOrder: updated.sortOrder } } });
        return { data: updated };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('家庭内已存在同名菜谱分类');
      throw error;
    }
  }

  async archiveCategory(userId: string, householdId: string, categoryId: string, dto: ArchiveCategoryDto) {
    return this.prisma.$transaction(async tx => {
      const membership = await this.access.require(userId, householdId, 'recipes', 'MANAGE', tx);
      const current = await tx.recipeCategory.findFirst({ where: { id: categoryId, householdId, archivedAt: null } });
      if (!current) throw new NotFoundException('菜谱分类不存在');
      const changed = await tx.recipeCategory.updateMany({ where: { id: categoryId, householdId, archivedAt: null, version: dto.expectedVersion }, data: { archivedAt: new Date(), version: { increment: 1 } } });
      if (!changed.count) throw new ConflictException('菜谱分类已被其他人修改，请刷新后重试');
      const archived = await tx.recipeCategory.findUniqueOrThrow({ where: { id: categoryId } });
      await tx.auditLog.create({ data: { householdId, actorMembershipId: membership.id, action: 'RECIPE_CATEGORY_ARCHIVE', targetId: categoryId, details: { name: current.name, fromVersion: current.version, toVersion: archived.version } } });
      return { data: archived };
    });
  }

  async createCategory(userId: string, householdId: string, dto: CreateCategoryDto) {
    await this.access.require(userId, householdId, 'recipes', 'MANAGE');
    try {
      return { data: await this.prisma.recipeCategory.create({ data: { householdId, name: dto.name.trim(), sortOrder: dto.sortOrder ?? 0 } }) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('家庭内已存在同名菜谱分类');
      throw error;
    }
  }

  async createRecipe(userId: string, householdId: string, dto: CreateRecipeDto) {
    const membership = await this.requireChef(userId, householdId);
    ensureDistinctIngredients(dto.ingredients);
    if (dto.categoryId) {
      const category = await this.prisma.recipeCategory.findFirst({ where: { id: dto.categoryId, householdId, archivedAt: null } });
      if (!category) throw new NotFoundException('Recipe category was not found');
    }
    const recipe = await this.prisma.$transaction(async (tx) => {
      const ingredients = await Promise.all(dto.ingredients.map((item) => tx.ingredient.upsert({
        where: { householdId_name_kind: { householdId, name: item.name.trim(), kind: 'FOOD' } },
        update: { defaultUnit: item.unit },
        create: { householdId, name: item.name.trim(), defaultUnit: item.unit },
      })));
      const seasonings = await Promise.all([...new Set(dto.seasonings.map(s => s.trim()).filter(Boolean))].map(name => tx.ingredient.upsert({
        where: { householdId_name_kind: { householdId, name, kind: 'SEASONING' } }, update: {}, create: { householdId, name, kind: 'SEASONING', defaultUnit: '' },
      })));
      return tx.recipe.create({
        data: {
          householdId, categoryId: dto.categoryId, name: dto.name.trim(),
          steps: dto.steps.map((step) => step.trim()), createdById: membership.id,
          ingredients: { create: dto.ingredients.map((item, index) => ({ ingredientId: ingredients[index].id, quantity: item.quantity, unit: item.unit, optional: item.optional ?? false })) },
          seasonings: { create: seasonings.map(s => ({ name: s.name, ingredientId: s.id })) },
        },
        include: recipeInclude,
      });
    });
    return { data: recipe };
  }

  async listRecipes(userId: string, householdId: string) {
    const membership = await this.requireMember(userId, householdId);
    const canManageRecipes = permits(membership.effectivePermissions, 'recipes', 'EDIT');
    return { data: await this.prisma.recipe.findMany({
      where: { householdId, ...(canManageRecipes ? {} : { status: RecipeStatus.PUBLISHED }) },
      include: recipeInclude,
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    }) };
  }

  async detail(userId: string, householdId: string, recipeId: string) {
    const membership = await this.requireMember(userId, householdId);
    const recipe = await this.prisma.recipe.findFirst({ where: { id: recipeId, householdId }, include: recipeInclude });
    if (!recipe || (recipe.status !== RecipeStatus.PUBLISHED && !permits(membership.effectivePermissions, 'recipes', 'EDIT'))) throw new NotFoundException('菜谱不存在');
    return { data: recipe };
  }

  async update(userId: string, householdId: string, recipeId: string, dto: UpdateRecipeDto) {
    ensureDistinctIngredients(dto.ingredients);
    return serializable(this.prisma, async tx => {
      const membership = await this.access.require(userId, householdId, 'recipes', 'EDIT', tx);
      const recipe = await tx.recipe.findFirst({ where: { id: recipeId, householdId } });
      if (!recipe) throw new NotFoundException('菜谱不存在');
      if (recipe.version !== dto.expectedVersion) throw new ConflictException('菜谱已被其他人修改，请刷新后重试');
      if (dto.categoryId && !await tx.recipeCategory.findFirst({ where: { id: dto.categoryId, householdId, archivedAt: null } })) throw new NotFoundException('菜谱分类不存在');
      const ingredients = await Promise.all(dto.ingredients.map(item => tx.ingredient.upsert({
        where: { householdId_name_kind: { householdId, name: item.name, kind: 'FOOD' } },
        update: { defaultUnit: item.unit }, create: { householdId, name: item.name, defaultUnit: item.unit },
      })));
      const seasoningNames = [...new Set(dto.seasonings.filter(Boolean))];
      const seasonings = await Promise.all(seasoningNames.map(name => tx.ingredient.upsert({
        where: { householdId_name_kind: { householdId, name, kind: 'SEASONING' } }, update: {}, create: { householdId, name, kind: 'SEASONING', defaultUnit: '' },
      })));
      const changed = await tx.recipe.updateMany({ where: { id: recipeId, householdId, version: dto.expectedVersion }, data: {
        name: dto.name, categoryId: dto.categoryId, steps: dto.steps, version: { increment: 1 },
      } });
      if (changed.count !== 1) throw new ConflictException('菜谱已被其他人修改，请刷新后重试');
      await tx.recipeIngredient.deleteMany({ where: { recipeId } });
      await tx.recipeSeasoning.deleteMany({ where: { recipeId } });
      await tx.recipeIngredient.createMany({ data: dto.ingredients.map((item, index) => ({ recipeId, ingredientId: ingredients[index].id, quantity: item.quantity, unit: item.unit, optional: item.optional ?? false })) });
      if (seasonings.length) await tx.recipeSeasoning.createMany({ data: seasonings.map(s => ({ recipeId, name: s.name, ingredientId: s.id })) });
      await tx.auditLog.create({ data: { householdId, actorMembershipId: membership.id, action: 'RECIPE_UPDATE', targetId: recipeId, details: { fromVersion: recipe.version, toVersion: recipe.version + 1 } } });
      return { data: await tx.recipe.findUniqueOrThrow({ where: { id: recipeId }, include: recipeInclude }) };
    });
  }

  async updateStatus(userId: string, householdId: string, recipeId: string, dto: UpdateRecipeStatusDto) {
    return serializable(this.prisma, async tx => {
      const membership = await this.access.require(userId, householdId, 'recipes', 'EDIT', tx);
      const recipe = await tx.recipe.findFirst({ where: { id: recipeId, householdId } });
      if (!recipe) throw new NotFoundException('菜谱不存在');
      if (recipe.version !== dto.expectedVersion) {
        if (recipe.version === dto.expectedVersion + 1 && recipe.status === dto.status) return { data: await tx.recipe.findUniqueOrThrow({ where: { id: recipeId }, include: recipeInclude }) };
        throw new ConflictException('菜谱已被其他人修改，请刷新后重试');
      }
      if (recipe.status === dto.status) return { data: await tx.recipe.findUniqueOrThrow({ where: { id: recipeId }, include: recipeInclude }) };
      if (dto.status === RecipeStatus.PUBLISHED) {
        if (!recipe.coverAssetId || !await tx.mediaAsset.findFirst({ where: { id: recipe.coverAssetId, householdId, status: 'READY' } })) throw new ConflictException('发布菜谱前请先上传并确认成品图片');
        const ingredientCount = await tx.recipeIngredient.count({ where: { recipeId } });
        const steps = Array.isArray(recipe.steps) ? recipe.steps.filter(step => typeof step === 'string' && step.trim()) : [];
        if (!ingredientCount || !steps.length) throw new ConflictException('发布菜谱前请至少填写一种食材和一个做法步骤');
      }
      const updated = await tx.recipe.update({ where: { id: recipeId }, data: { status: dto.status, version: { increment: 1 } }, include: recipeInclude });
      await tx.auditLog.create({ data: { householdId, actorMembershipId: membership.id, action: 'RECIPE_STATUS', targetId: recipeId, details: { from: recipe.status, to: dto.status, fromVersion: recipe.version, toVersion: updated.version } } });
      return { data: updated };
    });
  }

  private async requireMember(userId: string, householdId: string, level: Level = 'VIEW') {
    return this.access.require(userId, householdId, 'recipes', level);
  }

  private async requireChef(userId: string, householdId: string) {
    return this.access.require(userId, householdId, 'recipes', 'EDIT');
  }
}
