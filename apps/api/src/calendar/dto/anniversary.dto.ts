import { AnniversaryLeapPolicy, AnniversaryRecurrence } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Length, Matches, Min } from 'class-validator';
import { TrimText } from '../../common/trim-text';

export class CreateAnniversaryDto {
  @TrimText() @IsString() @Length(1, 80)
  title!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  localDate!: string;

  @IsEnum(AnniversaryRecurrence)
  recurrence!: AnniversaryRecurrence;

  @IsOptional() @IsEnum(AnniversaryLeapPolicy)
  leapPolicy?: AnniversaryLeapPolicy;

  @IsOptional() @TrimText() @IsString() @Length(1, 500)
  note?: string | null;
}

export class UpdateAnniversaryDto {
  @IsInt() @Min(1)
  expectedVersion!: number;

  @IsOptional() @TrimText() @IsString() @Length(1, 80)
  title?: string;

  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  localDate?: string;

  @IsOptional() @IsEnum(AnniversaryRecurrence)
  recurrence?: AnniversaryRecurrence;

  @IsOptional() @IsEnum(AnniversaryLeapPolicy)
  leapPolicy?: AnniversaryLeapPolicy;

  @IsOptional() @TrimText() @IsString() @Length(1, 500)
  note?: string | null;
}

export class ArchiveAnniversaryDto {
  @IsInt() @Min(1)
  expectedVersion!: number;
}
