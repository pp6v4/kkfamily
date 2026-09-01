import { TrimText } from '../../common/trim-text';
import { IsIn, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateShoppingItemDto {
  @TrimText() @IsString() @Length(1, 80)
  name!: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(999999999.999)
  quantity?: number;

  @IsOptional() @TrimText() @IsString() @Length(1, 12)
  unit?: string;
  @IsOptional() @IsIn(['WISHLIST', 'NEXT_TRIP', 'REPLENISH']) status?: 'WISHLIST' | 'NEXT_TRIP' | 'REPLENISH';
}
