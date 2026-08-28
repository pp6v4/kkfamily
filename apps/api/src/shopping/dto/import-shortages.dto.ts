import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsNumber, IsString, Length, ValidateNested } from 'class-validator';

class ShortageItemDto {
  @IsString() @Length(1, 80)
  ingredientId!: string;

  @IsNumber()
  quantity!: number;

  @IsString() @Length(1, 12)
  unit!: string;
}

export class ImportShortagesDto {
  @IsString() @Length(1, 80)
  mealId!: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100)
  @ValidateNested({ each: true }) @Type(() => ShortageItemDto)
  items!: ShortageItemDto[];
}
