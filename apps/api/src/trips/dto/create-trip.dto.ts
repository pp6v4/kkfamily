import { TrimText } from '../../common/trim-text';
import { IsDateString, IsOptional, IsString, Length } from 'class-validator';

export class CreateTripDto {
  @TrimText() @IsString() @Length(1, 80)
  title!: string;

  @IsDateString()
  startsAt!: string;

  @IsOptional() @IsDateString()
  endsAt?: string;

  @IsOptional() @TrimText() @IsString() @Length(1, 120)
  destination?: string;
}
