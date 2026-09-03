import { ArchiveValueType, ArchiveVisibility } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, Length, Matches, Min, ValidateNested } from 'class-validator';
import { TrimText } from '../common/trim-text';

export class ArchiveFieldGrantDto {
  @TrimText() @IsString() @Length(1, 80)
  membershipId!: string;

  @IsBoolean()
  canRead!: boolean;

  @IsBoolean()
  canEdit!: boolean;
}

export class CreateArchiveFieldDto {
  @TrimText() @IsString() @Matches(/^[a-z][a-z0-9_]{1,63}$/)
  key!: string;

  @TrimText() @IsString() @Length(1, 80)
  label!: string;

  @IsEnum(ArchiveValueType)
  valueType!: ArchiveValueType;

  @IsBoolean()
  sensitive!: boolean;

  @IsEnum(ArchiveVisibility)
  visibility!: ArchiveVisibility;

  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ArchiveFieldGrantDto)
  grants!: ArchiveFieldGrantDto[];
}

export class UpdateArchiveFieldDto {
  @IsInt() @Min(1)
  expectedVersion!: number;

  @IsOptional() @TrimText() @IsString() @Length(1, 80)
  label?: string;

  @IsOptional() @IsEnum(ArchiveValueType)
  valueType?: ArchiveValueType;

  @IsOptional() @IsBoolean()
  sensitive?: boolean;

  @IsOptional() @IsEnum(ArchiveVisibility)
  visibility?: ArchiveVisibility;

  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ArchiveFieldGrantDto)
  grants?: ArchiveFieldGrantDto[];
}

export class ArchiveFieldVersionDto {
  @IsInt() @Min(1)
  expectedVersion!: number;
}

export class SetArchiveValueDto {
  @IsInt() @Min(0)
  expectedVersion!: number;

  @IsString() @Length(0, 5000)
  value!: string;
}
