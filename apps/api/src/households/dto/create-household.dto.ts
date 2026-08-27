import { IsString, Length } from 'class-validator';

export class CreateHouseholdDto {
  @IsString()
  @Length(1, 40)
  name!: string;
}

