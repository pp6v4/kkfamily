import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';
import { AddMealItemDto } from './dto/add-meal-item.dto';
import { CreateMealDto } from './dto/create-meal.dto';
import { CompleteMealDto } from './dto/complete-meal.dto';
import { ListMealsDto } from './dto/list-meals.dto';
import { MealsService } from './meals.service';
import { MealVersionDto, RecalculateMealDto, ReopenMealDto, UpdateDishDto } from './dto/meal-workflow.dto';

@Controller('meals')
@UseGuards(AccessTokenGuard)
export class MealsController {
  constructor(private readonly mealsService: MealsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Query() query: ListMealsDto) {
    return this.mealsService.list(user.userId, householdId, query);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Body() dto: CreateMealDto) {
    return this.mealsService.create(user.userId, householdId, dto);
  }

  @Post(':id/items')
  addItem(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('id') mealId: string, @Body() dto: AddMealItemDto) {
    return this.mealsService.addItem(user.userId, householdId, mealId, dto);
  }

  @Delete(':id/items/:recipeId')
  removeItem(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('id') mealId: string, @Param('recipeId') recipeId: string) {
    return this.mealsService.removeItem(user.userId, householdId, mealId, recipeId);
  }

  @Post(':id/recalculate')
  recalculate(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('id') mealId: string, @Body() dto: RecalculateMealDto) {
    return this.mealsService.recalculate(user.userId, householdId, mealId, dto?.snapshotVersion);
  }

  @Post(':id/complete')
  complete(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('id') mealId: string, @Body() dto: CompleteMealDto) {
    return this.mealsService.complete(user.userId, householdId, mealId, dto);
  }

  @Patch(':id/dishes/:recipeId')
  dish(@CurrentUser() user: RequestUser, @Headers('x-household-id') house: string, @Param('id') id: string, @Param('recipeId') recipeId: string, @Body() dto: UpdateDishDto) {
    return this.mealsService.updateDish(user.userId, house, id, recipeId, dto);
  }
  @Get(':id/snapshots')
  snapshots(@CurrentUser() user: RequestUser, @Headers('x-household-id') house: string, @Param('id') id: string) {
    return this.mealsService.snapshots(user.userId, house, id);
  }
  @Post(':id/confirm')
  confirm(@CurrentUser() user: RequestUser, @Headers('x-household-id') house: string, @Param('id') id: string, @Body() dto: MealVersionDto) {
    return this.mealsService.transition(user.userId, house, id, 'confirm', dto);
  }
  @Post(':id/reopen')
  reopen(@CurrentUser() user: RequestUser, @Headers('x-household-id') house: string, @Param('id') id: string, @Body() dto: ReopenMealDto) {
    return this.mealsService.transition(user.userId, house, id, 'reopen', dto);
  }
  @Post(':id/start')
  start(@CurrentUser() user: RequestUser, @Headers('x-household-id') house: string, @Param('id') id: string, @Body() dto: MealVersionDto) {
    return this.mealsService.transition(user.userId, house, id, 'start', dto);
  }
  @Post(':id/cancel')
  cancel(@CurrentUser() user: RequestUser, @Headers('x-household-id') house: string, @Param('id') id: string, @Body() dto: MealVersionDto) {
    return this.mealsService.transition(user.userId, house, id, 'cancel', dto);
  }
}
