import { IsString, Length } from 'class-validator';

export class ApplyPackingTemplateDto {
  @IsString() @Length(1, 80)
  templateId!: string;
}
