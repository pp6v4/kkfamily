import { IsDateString, IsOptional, IsString, Length } from 'class-validator';

export class CreateTripDto {
  @IsString() @Length(1, 80)
  title!: string;

  @IsDateString()
  startsAt!: string;

  @IsOptional() @IsDateString()
  endsAt?: string;

  @IsOptional() @IsString() @Length(1, 120)
  destination?: string;
}
