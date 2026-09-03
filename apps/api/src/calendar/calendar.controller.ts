import { Body, Controller, Get, Headers, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';
import { CalendarService } from './calendar.service';
import { ArchiveAnniversaryDto, CreateAnniversaryDto, UpdateAnniversaryDto } from './dto/anniversary.dto';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto';
import { ListCalendarEventsDto } from './dto/list-calendar-events.dto';

@Controller('calendar')
@UseGuards(AccessTokenGuard)
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Get('events')
  list(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Query() query: ListCalendarEventsDto) {
    return this.calendarService.list(user.userId, householdId, query);
  }

  @Post('events')
  create(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Body() dto: CreateCalendarEventDto) {
    return this.calendarService.create(user.userId, householdId, dto);
  }

  @Get('anniversaries')
  anniversaries(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string) {
    return this.calendarService.listAnniversaries(user.userId, householdId);
  }

  @Post('anniversaries')
  createAnniversary(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Body() dto: CreateAnniversaryDto) {
    return this.calendarService.createAnniversary(user.userId, householdId, dto);
  }

  @Patch('anniversaries/:anniversaryId')
  updateAnniversary(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('anniversaryId') anniversaryId: string, @Body() dto: UpdateAnniversaryDto) {
    return this.calendarService.updateAnniversary(user.userId, householdId, anniversaryId, dto);
  }

  @Post('anniversaries/:anniversaryId/archive')
  archiveAnniversary(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('anniversaryId') anniversaryId: string, @Body() dto: ArchiveAnniversaryDto) {
    return this.calendarService.archiveAnniversary(user.userId, householdId, anniversaryId, dto);
  }
}
