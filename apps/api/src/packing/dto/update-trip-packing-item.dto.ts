import { PackingItemStatus } from '@prisma/client';
import { IsEnum, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

export class UpdateTripPackingItemDto {
  @IsOptional() @IsString() @Length(1, 80)
  name?: string;

  @IsOptional() @IsNumber() @Min(0.001)
  quantity?: number;

  @IsOptional() @IsString() @Length(0, 20)
  unit?: string;

  @IsOptional() @IsString() @Length(0, 200)
  note?: string;

  @IsOptional() @IsEnum(PackingItemStatus)
  status?: PackingItemStatus;

  @IsOptional() @IsString() @Length(0, 80)
  responsibleMembershipId?: string;
}
