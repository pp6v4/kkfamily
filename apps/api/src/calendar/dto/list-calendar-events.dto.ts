import { IsDateString } from 'class-validator';

export class ListCalendarEventsDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}
