import { TrimText } from '../../common/trim-text';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, Length, Min, ValidateNested } from 'class-validator';

class RecipeIngredientInput {
  @TrimText() @IsString() @Length(1, 60) name!: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) quantity?: number;
  @TrimText() @IsString() @Length(1, 12) unit!: string;
  @IsOptional() @IsBoolean() optional?: boolean;
}

export class UpdateRecipeDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @TrimText() @IsString() @Length(1, 80) name!: string;
  @IsOptional() @TrimText() @IsString() categoryId?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @TrimText() @IsString({ each: true }) @Length(1, 4000, { each: true }) steps!: string[];
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => RecipeIngredientInput) ingredients!: RecipeIngredientInput[];
  @IsArray() @ArrayMaxSize(40) @TrimText() @IsString({ each: true }) seasonings!: string[];
}
