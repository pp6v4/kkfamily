import { TrimText } from '../../common/trim-text';
import { TripMemberRole, TripMemberStatus, TripStatus } from '@prisma/client';
import { ArrayUnique, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

export class UpdateTripDto {
  @IsInt() @Min(1)
  expectedVersion!: number;
  @IsOptional() @TrimText() @IsString() @Length(1, 80)
  title?: string;
  @IsOptional() @IsDateString()
  startsAt?: string;
  @IsOptional() @IsDateString()
  endsAt?: string;
  @IsOptional() @TrimText() @IsString() @Length(0, 120)
  destination?: string;
}

export class UpdateTripStatusDto {
  @IsInt() @Min(1)
  expectedVersion!: number;
  @IsEnum(TripStatus)
  status!: TripStatus;
}

export class AddTripMemberDto {
  @TrimText() @IsString() @Length(1, 80)
  membershipId!: string;
  @IsOptional() @IsBoolean()
  canEdit?: boolean;
}

export class UpdateTripMemberDto {
  @IsInt() @Min(1)
  expectedVersion!: number;
  @IsOptional() @IsBoolean()
  canEdit?: boolean;
  @IsOptional() @IsEnum(TripMemberRole)
  tripRole?: TripMemberRole;
  @IsOptional() @IsEnum(TripMemberStatus)
  status?: TripMemberStatus;
  @IsOptional() @IsBoolean()
  clearResponsibilities?: boolean;
}

export class CreatePreparationGroupDto {
  @TrimText() @IsString() @Length(1, 40)
  name!: string;
  @IsArray() @ArrayUnique() @IsString({ each: true })
  membershipIds!: string[];
}

export class UpdatePreparationGroupDto extends CreatePreparationGroupDto {
  @IsInt() @Min(1)
  expectedVersion!: number;
}
