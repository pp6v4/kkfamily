import { IsInt, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { TrimText } from '../../common/trim-text';

export class MealVersionDto {
  @IsInt() @Min(1) expectedVersion!: number;
}
export class UpdateDishDto extends MealVersionDto {
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(100) cookMultiplier!: number;
}
export class ReopenMealDto extends MealVersionDto {
  @TrimText() @IsString() @Length(1, 300) reason!: string;
}
export class RecalculateMealDto {
  @IsOptional() @IsInt() @Min(1) snapshotVersion?: number;
}
