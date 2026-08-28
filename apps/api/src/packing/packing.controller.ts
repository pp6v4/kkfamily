import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';
import { ApplyPackingTemplateDto } from './dto/apply-packing-template.dto';
import { CreatePackingTemplateDto } from './dto/create-packing-template.dto';
import { CreateTripPackingItemDto } from './dto/create-trip-packing-item.dto';
import { UpdatePackingTemplateDto } from './dto/update-packing-template.dto';
import { UpdateTripPackingItemDto } from './dto/update-trip-packing-item.dto';
import { PackingService } from './packing.service';

@Controller()
@UseGuards(AccessTokenGuard)
export class PackingController {
  constructor(private readonly packingService: PackingService) {}

  @Get('packing-templates')
  listTemplates(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string) { return this.packingService.listTemplates(user.userId, householdId); }

  @Post('packing-templates')
  createTemplate(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Body() dto: CreatePackingTemplateDto) { return this.packingService.createTemplate(user.userId, householdId, dto); }

  @Patch('packing-templates/:id')
  updateTemplate(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('id') templateId: string, @Body() dto: UpdatePackingTemplateDto) { return this.packingService.updateTemplate(user.userId, householdId, templateId, dto); }

  @Get('trips/:tripId/packing-items')
  listTripItems(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('tripId') tripId: string) { return this.packingService.listTripItems(user.userId, householdId, tripId); }

  @Post('trips/:tripId/packing-items/apply-template')
  applyTemplate(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('tripId') tripId: string, @Body() dto: ApplyPackingTemplateDto) { return this.packingService.applyTemplate(user.userId, householdId, tripId, dto); }

  @Post('trips/:tripId/packing-items')
  createTripItem(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('tripId') tripId: string, @Body() dto: CreateTripPackingItemDto) { return this.packingService.createTripItem(user.userId, householdId, tripId, dto); }

  @Patch('trips/:tripId/packing-items/:itemId')
  updateTripItem(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('tripId') tripId: string, @Param('itemId') itemId: string, @Body() dto: UpdateTripPackingItemDto) { return this.packingService.updateTripItem(user.userId, householdId, tripId, itemId, dto); }

  @Delete('trips/:tripId/packing-items/:itemId')
  removeTripItem(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('tripId') tripId: string, @Param('itemId') itemId: string) { return this.packingService.removeTripItem(user.userId, householdId, tripId, itemId); }
}
