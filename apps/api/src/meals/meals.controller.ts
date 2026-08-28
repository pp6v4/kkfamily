import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';
import { AddMealItemDto } from './dto/add-meal-item.dto';
import { CreateMealDto } from './dto/create-meal.dto';
import { ListMealsDto } from './dto/list-meals.dto';
import { MealsService } from './meals.service';

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

  @Post(':id/recalculate')
  recalculate(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('id') mealId: string) {
    return this.mealsService.recalculate(user.userId, householdId, mealId);
  }
}
