import { FavoriteConversionTarget, FavoriteType, FavoriteVisibility } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsEnum, IsInt, IsOptional, IsString, IsUrl, Length, Min } from 'class-validator';
import { TrimText } from '../common/trim-text';

export class CreateFavoriteDto {
  @IsEnum(FavoriteType)
  type!: FavoriteType;

  @TrimText() @IsString() @Length(1, 120)
  title!: string;

  @IsOptional() @TrimText() @IsString() @Length(0, 5000)
  text?: string;

  @IsOptional() @TrimText() @IsUrl({ protocols: ['http', 'https'], require_protocol: true }) @Length(1, 2000)
  sourceUrl?: string;

  @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @Length(1, 40, { each: true })
  tags!: string[];

  @IsEnum(FavoriteVisibility)
  visibility!: FavoriteVisibility;
}

export class UpdateFavoriteDto {
  @IsInt() @Min(1)
  expectedVersion!: number;

  @IsOptional() @IsEnum(FavoriteType)
  type?: FavoriteType;

  @IsOptional() @TrimText() @IsString() @Length(1, 120)
  title?: string;

  @IsOptional() @TrimText() @IsString() @Length(0, 5000)
  text?: string | null;

  @IsOptional() @TrimText() @IsUrl({ protocols: ['http', 'https'], require_protocol: true }) @Length(1, 2000)
  sourceUrl?: string | null;

  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @Length(1, 40, { each: true })
  tags?: string[];

  @IsOptional() @IsEnum(FavoriteVisibility)
  visibility?: FavoriteVisibility;
}

export class ArchiveFavoriteDto {
  @IsInt() @Min(1)
  expectedVersion!: number;
}

export class ConvertFavoriteDto {
  @IsInt() @Min(1)
  expectedVersion!: number;

  @IsEnum(FavoriteConversionTarget)
  targetType!: FavoriteConversionTarget;

  @TrimText() @IsString() @Length(8, 120)
  idempotencyKey!: string;

  @TrimText() @IsString() @Length(1, 120)
  confirmedTitle!: string;

  @IsOptional() @TrimText() @IsString() @Length(0, 2000)
  confirmedDescription?: string;
}
