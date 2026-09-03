import { IsDateString } from 'class-validator';

export class DashboardRangeDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}
