import { Body, Controller, Get, Headers, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';
import { ImportShortagesDto } from './dto/import-shortages.dto';
import { CreateShoppingItemDto } from './dto/create-shopping-item.dto';
import { UpdateShoppingItemDto } from './dto/update-shopping-item.dto';
import { ShoppingService } from './shopping.service';

@Controller('shopping-lists')
@UseGuards(AccessTokenGuard)
export class ShoppingController {
  constructor(private readonly shoppingService: ShoppingService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string) {
    return this.shoppingService.list(user.userId, householdId);
  }

  @Post('next-trip/items')
  createItem(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Body() dto: CreateShoppingItemDto) {
    return this.shoppingService.createItem(user.userId, householdId, dto);
  }

  @Patch('items/:id')
  updateItem(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('id') itemId: string, @Body() dto: UpdateShoppingItemDto) {
    return this.shoppingService.updateItem(user.userId, householdId, itemId, dto.status);
  }

  @Post('next-trip/import-shortages')
  importShortages(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Body() dto: ImportShortagesDto) {
    return this.shoppingService.importShortages(user.userId, householdId, dto);
  }
}
