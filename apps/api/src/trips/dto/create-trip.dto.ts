import { TrimText } from '../../common/trim-text';
import { Type } from 'class-transformer';
import { IsDateString, IsDefined, IsNumber, IsObject, IsOptional, IsString, Length, Max, Min, ValidateIf, ValidateNested } from 'class-validator';

export class InitialDestinationDto {
  @TrimText() @IsString() @Length(1, 80)
  title!: string;

  @IsNumber() @Min(-90) @Max(90)
  latitude!: number;

  @IsNumber() @Min(-180) @Max(180)
  longitude!: number;
}

export class CreateTripDto {
  @TrimText() @IsString() @Length(1, 80)
  title!: string;

  @IsDateString()
  startsAt!: string;

  @IsOptional() @IsDateString()
  endsAt?: string;

  @IsOptional() @TrimText() @IsString() @Length(1, 120)
  destination?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsDefined() @IsObject() @ValidateNested() @Type(() => InitialDestinationDto)
  initialDestination?: InitialDestinationDto;
}
