import { TrimText } from '../../common/trim-text';
import { IngredientKind, StockAvailability } from '@prisma/client';
import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class SetInventoryItemDto {
  @TrimText() @IsString() @Length(1, 60)
  name!: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(999999999.999)
  quantity?: number;

  @IsOptional() @TrimText() @IsString() @Length(1, 12)
  unit?: string;

  @IsOptional() @TrimText() @IsString() @Length(1, 60)
  location?: string;
  @IsOptional() @IsEnum(IngredientKind) kind?: IngredientKind;
  @IsOptional() @IsEnum(StockAvailability) availability?: StockAvailability;
  @IsOptional() @IsDateString() expiresAt?: string;
  @IsOptional() @TrimText() @IsString() @Length(1, 80) id?: string;
  @IsOptional() @IsInt() @Min(1) expectedVersion?: number;
}
