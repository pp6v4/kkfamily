import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsOptional, IsString, Length, ValidateNested } from 'class-validator';
import { PackingTemplateItemInput } from './create-packing-template.dto';

export class UpdatePackingTemplateDto {
  @IsOptional() @IsString() @Length(1, 80)
  name?: string;

  @IsOptional() @IsString() @Length(0, 300)
  description?: string;

  @IsOptional() @IsBoolean()
  archived?: boolean;

  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100)
  @ValidateNested({ each: true }) @Type(() => PackingTemplateItemInput)
  items?: PackingTemplateItemInput[];
}
