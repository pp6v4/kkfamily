import { IsDateString } from 'class-validator';

export class ListMealsDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}
