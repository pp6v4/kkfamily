import { IsEnum, IsInt, Min } from 'class-validator';
import { ShoppingItemStatus } from '@prisma/client';

export class UpdateShoppingItemDto {
  @IsEnum(ShoppingItemStatus)
  status!: ShoppingItemStatus;
  @IsInt() @Min(1) expectedVersion!: number;
}
