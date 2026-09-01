import { TrimText } from '../../common/trim-text';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsOptional, IsString, Length, ValidateNested } from 'class-validator';
import { PackingTemplateItemInput } from './create-packing-template.dto';

export class UpdatePackingTemplateDto {
  @IsOptional() @TrimText() @IsString() @Length(1, 80)
  name?: string;

  @IsOptional() @TrimText() @IsString() @Length(0, 300)
  description?: string;

  @IsOptional() @IsBoolean()
  archived?: boolean;

  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100)
  @ValidateNested({ each: true }) @Type(() => PackingTemplateItemInput)
  items?: PackingTemplateItemInput[];
}
