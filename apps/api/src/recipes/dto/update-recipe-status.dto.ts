import { IsEnum } from 'class-validator';
import { RecipeStatus } from '@prisma/client';

export class UpdateRecipeStatusDto {
  @IsEnum(RecipeStatus)
  status!: RecipeStatus;
}
