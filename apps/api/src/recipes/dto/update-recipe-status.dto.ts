import { IsEnum, IsInt, Min } from 'class-validator';
import { RecipeStatus } from '@prisma/client';

export class UpdateRecipeStatusDto {
  @IsEnum(RecipeStatus)
  status!: RecipeStatus;

  @IsInt() @Min(1)
  expectedVersion!: number;
}
