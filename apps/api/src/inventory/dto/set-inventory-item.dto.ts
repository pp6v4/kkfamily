import { IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

export class SetInventoryItemDto {
  @IsString() @Length(1, 60)
  name!: string;

  @IsNumber() @Min(0)
  quantity!: number;

  @IsString() @Length(1, 12)
  unit!: string;

  @IsOptional() @IsString() @Length(1, 60)
  location?: string;
}
