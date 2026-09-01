import { TrimText } from '../../common/trim-text';
import { IsString, Length } from 'class-validator';

export class CreateHouseholdDto {
  @TrimText() @IsString()
  @Length(1, 40)
  name!: string;
}

