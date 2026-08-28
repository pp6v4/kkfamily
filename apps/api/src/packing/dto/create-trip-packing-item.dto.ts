import { IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

export class CreateTripPackingItemDto {
  @IsString() @Length(1, 80)
  name!: string;

  @IsOptional() @IsNumber() @Min(0.001)
  quantity?: number;

  @IsOptional() @IsString() @Length(1, 20)
  unit?: string;

  @IsOptional() @IsString() @Length(1, 200)
  note?: string;

  @IsOptional() @IsString() @Length(1, 80)
  responsibleMembershipId?: string;
}
