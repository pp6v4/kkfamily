import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { TrimText } from '../../common/trim-text';

export class UpdateCategoryDto {
  @IsInt() @Min(1)
  expectedVersion!: number;

  @IsOptional() @TrimText() @IsString() @Length(1, 30)
  name?: string;

  @IsOptional() @IsInt() @Min(0) @Max(999)
  sortOrder?: number;
}

export class ArchiveCategoryDto {
  @IsInt() @Min(1)
  expectedVersion!: number;
}
