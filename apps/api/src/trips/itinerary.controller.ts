import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';
import { CreateAccommodationDto, CreateTripLegDto, CreateTripStopDto, ReorderTripStopsDto, UpdateAccommodationDto, UpdateTripLegDto, UpdateTripStopDto, VersionQueryDto } from './dto/itinerary.dto';
import { ItineraryService } from './itinerary.service';

@Controller('trips')
@UseGuards(AccessTokenGuard)
export class ItineraryController {
  constructor(private readonly itinerary: ItineraryService) {}

  @Get(':tripId/itinerary')
  list(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('tripId') tripId: string) { return this.itinerary.list(user.userId, householdId, tripId); }

  @Get(':tripId/stops')
  async stops(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('tripId') tripId: string) { const result = await this.itinerary.list(user.userId, householdId, tripId); return { data: { tripVersion: result.data.tripVersion, items: result.data.stops } }; }

  @Post(':tripId/stops')
  createStop(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('tripId') tripId: string, @Body() dto: CreateTripStopDto) { return this.itinerary.createStop(user.userId, householdId, tripId, dto); }

  @Patch(':tripId/stops/:stopId')
  updateStop(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('tripId') tripId: string, @Param('stopId') stopId: string, @Body() dto: UpdateTripStopDto) { return this.itinerary.updateStop(user.userId, householdId, tripId, stopId, dto); }

  @Post(':tripId/stops/reorder')
  reorderStops(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('tripId') tripId: string, @Body() dto: ReorderTripStopsDto) { return this.itinerary.reorderStops(user.userId, householdId, tripId, dto); }

  @Get(':tripId/stops/:stopId/delete-impact')
  stopDeleteImpact(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('tripId') tripId: string, @Param('stopId') stopId: string) { return this.itinerary.stopDeleteImpact(user.userId, householdId, tripId, stopId); }

  @Delete(':tripId/stops/:stopId')
  removeStop(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('tripId') tripId: string, @Param('stopId') stopId: string, @Query() dto: VersionQueryDto) { return this.itinerary.removeStop(user.userId, householdId, tripId, stopId, dto.expectedVersion, dto.expectedTripVersion, dto.confirm); }

  @Get(':tripId/legs')
  async legs(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('tripId') tripId: string) { const result = await this.itinerary.list(user.userId, householdId, tripId); return { data: { tripVersion: result.data.tripVersion, items: result.data.legs } }; }

  @Post(':tripId/legs')
  createLeg(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('tripId') tripId: string, @Body() dto: CreateTripLegDto) { return this.itinerary.createLeg(user.userId, householdId, tripId, dto); }

  @Patch(':tripId/legs/:legId')
  updateLeg(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('tripId') tripId: string, @Param('legId') legId: string, @Body() dto: UpdateTripLegDto) { return this.itinerary.updateLeg(user.userId, householdId, tripId, legId, dto); }

  @Delete(':tripId/legs/:legId')
  removeLeg(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('tripId') tripId: string, @Param('legId') legId: string, @Query() dto: VersionQueryDto) { return this.itinerary.removeLeg(user.userId, householdId, tripId, legId, dto.expectedVersion, dto.expectedTripVersion); }

  @Get(':tripId/accommodations')
  async accommodations(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('tripId') tripId: string) { const result = await this.itinerary.list(user.userId, householdId, tripId); return { data: { tripVersion: result.data.tripVersion, items: result.data.accommodations } }; }

  @Post(':tripId/accommodations')
  createAccommodation(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('tripId') tripId: string, @Body() dto: CreateAccommodationDto) { return this.itinerary.createAccommodation(user.userId, householdId, tripId, dto); }

  @Patch(':tripId/accommodations/:accommodationId')
  updateAccommodation(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('tripId') tripId: string, @Param('accommodationId') accommodationId: string, @Body() dto: UpdateAccommodationDto) { return this.itinerary.updateAccommodation(user.userId, householdId, tripId, accommodationId, dto); }

  @Delete(':tripId/accommodations/:accommodationId')
  removeAccommodation(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('tripId') tripId: string, @Param('accommodationId') accommodationId: string, @Query() dto: VersionQueryDto) { return this.itinerary.removeAccommodation(user.userId, householdId, tripId, accommodationId, dto.expectedVersion, dto.expectedTripVersion); }
}
