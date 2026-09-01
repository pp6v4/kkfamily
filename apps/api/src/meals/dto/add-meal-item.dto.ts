import { TrimText } from '../../common/trim-text';
import { IsOptional, IsString, Length } from 'class-validator';

export class AddMealItemDto {
  @TrimText() @IsString() @Length(1, 80)
  recipeId!: string;

  @IsOptional() @TrimText() @IsString() @Length(1, 160)
  note?: string;
}
