import { AccessService } from '../access/access.service';
import { Level, permits } from '../access/permission-policy';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RecipeStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateRecipeDto } from './dto/create-recipe.dto';

@Injectable()
export class RecipesService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService) {}

  async listCategories(userId: string, householdId: string) {
    await this.requireMember(userId, householdId);
    return { data: await this.prisma.recipeCategory.findMany({ where: { householdId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }) };
  }

  async createCategory(userId: string, householdId: string, dto: CreateCategoryDto) {
    await this.access.require(userId, householdId, 'recipes', 'MANAGE');
    return { data: await this.prisma.recipeCategory.create({ data: { householdId, name: dto.name.trim(), sortOrder: dto.sortOrder ?? 0 } }) };
  }

  async createRecipe(userId: string, householdId: string, dto: CreateRecipeDto) {
    const membership = await this.requireChef(userId, householdId);
    if (new Set(dto.ingredients.map(i => i.name.trim())).size !== dto.ingredients.length) throw new BadRequestException('同一道菜的食材名称不能重复，请合并用量');
    if (dto.categoryId) {
      const category = await this.prisma.recipeCategory.findFirst({ where: { id: dto.categoryId, householdId } });
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
          householdId, categoryId: dto.categoryId, name: dto.name.trim(), coverObjectKey: dto.coverObjectKey,
          steps: dto.steps.map((step) => step.trim()), createdById: membership.id,
          ingredients: { create: dto.ingredients.map((item, index) => ({ ingredientId: ingredients[index].id, quantity: item.quantity, unit: item.unit, optional: item.optional ?? false })) },
          seasonings: { create: seasonings.map(s => ({ name: s.name, ingredientId: s.id })) },
        },
        include: { category: true, ingredients: { include: { ingredient: true } }, seasonings: true },
      });
    });
    return { data: recipe };
  }

  async listRecipes(userId: string, householdId: string) {
    const membership = await this.requireMember(userId, householdId);
    const canManageRecipes = permits(membership.effectivePermissions, 'recipes', 'EDIT');
    return { data: await this.prisma.recipe.findMany({
      where: { householdId, ...(canManageRecipes ? {} : { status: RecipeStatus.PUBLISHED }) },
      include: { category: true, ingredients: { include: { ingredient: true } }, seasonings: true },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    }) };
  }

  async updateStatus(userId: string, householdId: string, recipeId: string, status: RecipeStatus) {
    await this.requireChef(userId, householdId);
    const recipe = await this.prisma.recipe.findFirst({ where: { id: recipeId, householdId } });
    if (!recipe) throw new NotFoundException('Recipe was not found');
    return { data: await this.prisma.recipe.update({ where: { id: recipeId }, data: { status } }) };
  }

  private async requireMember(userId: string, householdId: string, level: Level = 'VIEW') {
    return this.access.require(userId, householdId, 'recipes', level);
  }

  private async requireChef(userId: string, householdId: string) {
    return this.access.require(userId, householdId, 'recipes', 'EDIT');
  }
}
