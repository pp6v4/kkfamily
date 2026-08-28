import { Body, Controller, Get, Headers, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { UpdateRecipeStatusDto } from './dto/update-recipe-status.dto';
import { RecipesService } from './recipes.service';

@Controller('recipes')
@UseGuards(AccessTokenGuard)
export class RecipesController {
  constructor(private readonly recipesService: RecipesService) {}

  @Get('categories')
  categories(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string) {
    return this.recipesService.listCategories(user.userId, householdId);
  }

  @Post('categories')
  createCategory(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Body() dto: CreateCategoryDto) {
    return this.recipesService.createCategory(user.userId, householdId, dto);
  }

  @Post()
  createRecipe(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Body() dto: CreateRecipeDto) {
    return this.recipesService.createRecipe(user.userId, householdId, dto);
  }

  @Get()
  list(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string) {
    return this.recipesService.listRecipes(user.userId, householdId);
  }

  @Patch(':id/status')
  updateStatus(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('id') recipeId: string, @Body() dto: UpdateRecipeStatusDto) {
    return this.recipesService.updateStatus(user.userId, householdId, recipeId, dto.status);
  }
}

