import { TrimText } from '../../common/trim-text';
import { IsString, Length } from 'class-validator';

export class ApplyPackingTemplateDto {
  @TrimText() @IsString() @Length(1, 80)
  templateId!: string;
}
