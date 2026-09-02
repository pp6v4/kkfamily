import { Body, Controller, Get, Headers, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';
import { CreateTripDto } from './dto/create-trip.dto';
import { AddTripMemberDto, CreatePreparationGroupDto, UpdatePreparationGroupDto, UpdateTripDto, UpdateTripMemberDto, UpdateTripStatusDto } from './dto/trip-actions.dto';
import { TripsService } from './trips.service';

@Controller('trips')
@UseGuards(AccessTokenGuard)
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}
  @Get() list(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string) { return this.tripsService.list(user.userId, householdId); }
  @Post() create(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Body() dto: CreateTripDto) { return this.tripsService.create(user.userId, householdId, dto); }
  @Get(':id') detail(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('id') id: string) { return this.tripsService.detail(user.userId, householdId, id); }
  @Patch(':id') update(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('id') id: string, @Body() dto: UpdateTripDto) { return this.tripsService.update(user.userId, householdId, id, dto); }
  @Patch(':id/status') updateStatus(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('id') id: string, @Body() dto: UpdateTripStatusDto) { return this.tripsService.updateStatus(user.userId, householdId, id, dto); }
  @Get(':id/candidates') candidates(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('id') id: string) { return this.tripsService.candidates(user.userId, householdId, id); }
  @Post(':id/members') addMember(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('id') id: string, @Body() dto: AddTripMemberDto) { return this.tripsService.addMember(user.userId, householdId, id, dto); }
  @Patch(':id/members/:membershipId') updateMember(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('id') id: string, @Param('membershipId') membershipId: string, @Body() dto: UpdateTripMemberDto) { return this.tripsService.updateMember(user.userId, householdId, id, membershipId, dto); }
  @Post(':id/preparation-groups') createGroup(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('id') id: string, @Body() dto: CreatePreparationGroupDto) { return this.tripsService.createGroup(user.userId, householdId, id, dto); }
  @Patch(':id/preparation-groups/:groupId') updateGroup(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('id') id: string, @Param('groupId') groupId: string, @Body() dto: UpdatePreparationGroupDto) { return this.tripsService.updateGroup(user.userId, householdId, id, groupId, dto); }
}
