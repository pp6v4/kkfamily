import { Body, Controller, Get, Headers, Post, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';
import { CreateTripDto } from './dto/create-trip.dto';
import { TripsService } from './trips.service';

@Controller('trips')
@UseGuards(AccessTokenGuard)
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string) { return this.tripsService.list(user.userId, householdId); }

  @Post()
  create(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Body() dto: CreateTripDto) { return this.tripsService.create(user.userId, householdId, dto); }
}
