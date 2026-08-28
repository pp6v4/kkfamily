import { IsOptional, IsString, Length } from 'class-validator';

export class AddMealItemDto {
  @IsString() @Length(1, 80)
  recipeId!: string;

  @IsOptional() @IsString() @Length(1, 160)
  note?: string;
}
