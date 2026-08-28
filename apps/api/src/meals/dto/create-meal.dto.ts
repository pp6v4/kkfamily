import { IsDateString, IsString, Length } from 'class-validator';

export class CreateMealDto {
  @IsDateString()
  scheduledAt!: string;

  @IsString() @Length(1, 20)
  mealType!: string;
}
