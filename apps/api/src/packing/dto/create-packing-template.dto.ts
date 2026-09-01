import { TrimText } from '../../common/trim-text';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsNumber, IsOptional, IsString, Length, Min, ValidateNested } from 'class-validator';

export class PackingTemplateItemInput {
  @IsOptional() @TrimText() @IsString() @Length(1, 80)
  id?: string;

  @TrimText() @IsString() @Length(1, 80)
  name!: string;

  @IsOptional() @IsNumber() @Min(0.001)
  quantity?: number;

  @IsOptional() @TrimText() @IsString() @Length(1, 20)
  unit?: string;

  @IsOptional() @TrimText() @IsString() @Length(1, 200)
  note?: string;

  @IsOptional() @IsInt() @Min(0)
  sortOrder?: number;
}

export class CreatePackingTemplateDto {
  @TrimText() @IsString() @Length(1, 80)
  name!: string;

  @IsOptional() @TrimText() @IsString() @Length(1, 300)
  description?: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100)
  @ValidateNested({ each: true }) @Type(() => PackingTemplateItemInput)
  items!: PackingTemplateItemInput[];
}
