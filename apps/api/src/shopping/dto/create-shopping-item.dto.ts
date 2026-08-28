import { IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

export class CreateShoppingItemDto {
  @IsString() @Length(1, 80)
  name!: string;

  @IsOptional() @IsNumber() @Min(0.001)
  quantity?: number;

  @IsOptional() @IsString() @Length(1, 12)
  unit?: string;
}
