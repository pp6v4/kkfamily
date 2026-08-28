import { IsEnum } from 'class-validator';
import { ShoppingItemStatus } from '@prisma/client';

export class UpdateShoppingItemDto {
  @IsEnum(ShoppingItemStatus)
  status!: ShoppingItemStatus;
}
