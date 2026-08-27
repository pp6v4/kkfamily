import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsNumber, IsOptional, IsString, Length, ValidateNested } from 'class-validator';

class IngredientInput {
  @IsString() @Length(1, 60) name!: string;
  @IsOptional() @IsNumber() quantity?: number;
  @IsString() @Length(1, 12) unit!: string;
  @IsOptional() @IsBoolean() optional?: boolean;
}

export class CreateRecipeDto {
  @IsString() @Length(1, 80) name!: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() coverObjectKey?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsString({ each: true }) steps!: string[];
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => IngredientInput) ingredients!: IngredientInput[];
  @IsArray() @ArrayMaxSize(40) @IsString({ each: true }) seasonings!: string[];
}

