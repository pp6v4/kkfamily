import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateCategoryDto {
  @IsString() @Length(1, 30) name!: string;
  @IsOptional() @IsInt() @Min(0) @Max(999) sortOrder?: number;
}

