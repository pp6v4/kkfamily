import { Body, Controller, Get, Headers, Post, Query, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';
import { CalendarService } from './calendar.service';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto';
import { ListCalendarEventsDto } from './dto/list-calendar-events.dto';

@Controller('calendar/events')
@UseGuards(AccessTokenGuard)
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Query() query: ListCalendarEventsDto) {
    return this.calendarService.list(user.userId, householdId, query);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Body() dto: CreateCalendarEventDto) {
    return this.calendarService.create(user.userId, householdId, dto);
  }
}
