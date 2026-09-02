import { TrimText } from '../../common/trim-text';
import { PackingItemStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

export class UpdateTripPackingItemDto {
  @IsInt() @Min(1)
  expectedVersion!: number;

  @IsOptional() @TrimText() @IsString() @Length(1, 80)
  name?: string;

  @IsOptional() @IsNumber() @Min(0.001)
  quantity?: number;

  @IsOptional() @TrimText() @IsString() @Length(0, 20)
  unit?: string;

  @IsOptional() @TrimText() @IsString() @Length(0, 200)
  note?: string;

  @IsOptional() @IsEnum(PackingItemStatus)
  status?: PackingItemStatus;

  @IsOptional() @TrimText() @IsString() @Length(0, 80)
  responsibleMembershipId?: string;

  @IsOptional() @TrimText() @IsString() @Length(0, 80)
  groupId?: string;
}

export class RemoveTripPackingItemDto {
  @Type(() => Number) @IsInt() @Min(1)
  expectedVersion!: number;
}
