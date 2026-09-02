import { TrimText } from '../../common/trim-text';
import { TripRouteKind, TripStopType, TripTransportMode } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

export class TripVersionDto {
  @IsInt() @Min(1)
  expectedTripVersion!: number;
}

export class CreateTripStopDto extends TripVersionDto {
  @TrimText() @IsString() @Length(1, 80)
  title!: string;
  @IsEnum(TripStopType)
  stopType!: TripStopType;
  @IsNumber() @Min(-90) @Max(90)
  latitude!: number;
  @IsNumber() @Min(-180) @Max(180)
  longitude!: number;
  @IsOptional() @IsDateString()
  arriveAt?: string;
  @IsOptional() @IsDateString()
  leaveAt?: string;
  @IsOptional() @IsInt() @Min(0)
  sortOrder?: number;
  @IsOptional() @TrimText() @IsString() @Length(0, 500)
  note?: string;
}

export class UpdateTripStopDto extends TripVersionDto {
  @IsInt() @Min(1)
  expectedVersion!: number;
  @IsOptional() @TrimText() @IsString() @Length(1, 80)
  title?: string;
  @IsOptional() @IsEnum(TripStopType)
  stopType?: TripStopType;
  @IsOptional() @IsNumber() @Min(-90) @Max(90)
  latitude?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180)
  longitude?: number;
  @IsOptional() @IsDateString()
  arriveAt?: string | null;
  @IsOptional() @IsDateString()
  leaveAt?: string | null;
  @IsOptional() @TrimText() @IsString() @Length(0, 500)
  note?: string;
}

export class ReorderTripStopsDto extends TripVersionDto {
  @IsArray() @ArrayMinSize(1) @ArrayUnique() @IsString({ each: true })
  stopIds!: string[];
}

export class CreateTripLegDto extends TripVersionDto {
  @TrimText() @IsString() @Length(1, 80)
  fromStopId!: string;
  @TrimText() @IsString() @Length(1, 80)
  toStopId!: string;
  @IsEnum(TripTransportMode)
  mode!: TripTransportMode;
  @IsOptional() @IsEnum(TripRouteKind)
  routeKind?: TripRouteKind;
  @IsOptional() @IsArray()
  geometry?: number[][];
  @IsOptional() @TrimText() @IsString() @Length(1, 40)
  provider?: string;
  @IsOptional() @IsInt() @Min(0)
  distanceMeters?: number;
  @IsOptional() @IsInt() @Min(0)
  durationSeconds?: number;
}

export class UpdateTripLegDto extends TripVersionDto {
  @IsInt() @Min(1)
  expectedVersion!: number;
  @IsOptional() @TrimText() @IsString() @Length(1, 80)
  fromStopId?: string;
  @IsOptional() @TrimText() @IsString() @Length(1, 80)
  toStopId?: string;
  @IsOptional() @IsEnum(TripTransportMode)
  mode?: TripTransportMode;
  @IsOptional() @IsEnum(TripRouteKind)
  routeKind?: TripRouteKind;
  @IsOptional() @IsArray()
  geometry?: number[][];
  @IsOptional() @TrimText() @IsString() @Length(0, 40)
  provider?: string;
  @IsOptional() @IsInt() @Min(0)
  distanceMeters?: number;
  @IsOptional() @IsInt() @Min(0)
  durationSeconds?: number;
}

export class CreateAccommodationDto extends TripVersionDto {
  @IsOptional() @TrimText() @IsString() @Length(1, 80)
  stopId?: string;
  @TrimText() @IsString() @Length(1, 100)
  name!: string;
  @IsOptional() @TrimText() @IsString() @Length(0, 200)
  address?: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  checkInDate!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  checkOutDate!: string;
  @IsOptional() @TrimText() @IsString() @Length(0, 100)
  contact?: string;
  @IsOptional() @TrimText() @IsString() @Length(0, 1000)
  reservationNote?: string;
}

export class UpdateAccommodationDto extends TripVersionDto {
  @IsInt() @Min(1)
  expectedVersion!: number;
  @IsOptional() @TrimText() @IsString() @Length(0, 80)
  stopId?: string | null;
  @IsOptional() @TrimText() @IsString() @Length(1, 100)
  name?: string;
  @IsOptional() @TrimText() @IsString() @Length(0, 200)
  address?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  checkInDate?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  checkOutDate?: string;
  @IsOptional() @TrimText() @IsString() @Length(0, 100)
  contact?: string;
  @IsOptional() @TrimText() @IsString() @Length(0, 1000)
  reservationNote?: string;
}

export class VersionQueryDto {
  @Type(() => Number) @IsInt() @Min(1)
  expectedVersion!: number;
  @Type(() => Number) @IsInt() @Min(1)
  expectedTripVersion!: number;
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean()
  confirm?: boolean;
}
