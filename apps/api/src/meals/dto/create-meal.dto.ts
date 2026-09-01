import { TrimText } from '../../common/trim-text';
import { IsDateString, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateMealDto {
  @IsDateString()
  scheduledAt!: string;

  @TrimText() @IsIn(['早餐', '午餐', '晚餐', '加餐', 'BREAKFAST', 'LUNCH', 'DINNER', 'OTHER'])
  mealType!: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) localDate?: string;
  @IsOptional() @TrimText() @IsString() @Length(1, 40) slotKey?: string;
}
