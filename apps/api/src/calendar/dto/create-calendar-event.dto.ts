import { TrimText } from '../../common/trim-text';
import { IsDateString, IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { CalendarEventType } from '@prisma/client';

export class CreateCalendarEventDto {
  @IsEnum(CalendarEventType)
  type!: CalendarEventType;

  @TrimText() @IsString() @Length(1, 80)
  title!: string;

  @IsDateString()
  startsAt!: string;

  @IsOptional() @IsDateString()
  endsAt?: string;

  @IsOptional() @TrimText() @IsString() @Length(1, 40)
  sourceType?: string;

  @IsOptional() @TrimText() @IsString() @Length(1, 80)
  sourceId?: string;
}
