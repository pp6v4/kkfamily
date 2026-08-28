import { Body, Controller, Get, Headers, Post, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';
import { SetInventoryItemDto } from './dto/set-inventory-item.dto';
import { InventoryService } from './inventory.service';

@Controller('inventory')
@UseGuards(AccessTokenGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string) {
    return this.inventoryService.list(user.userId, householdId);
  }

  @Post()
  set(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Body() dto: SetInventoryItemDto) {
    return this.inventoryService.set(user.userId, householdId, dto);
  }
}
