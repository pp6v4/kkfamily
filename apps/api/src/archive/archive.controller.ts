import { Body, Controller, Get, Headers, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';
import { ArchiveFieldVersionDto, CreateArchiveFieldDto, SetArchiveValueDto, UpdateArchiveFieldDto } from './archive.dto';
import { ArchiveService } from './archive.service';

@Controller('archive')
@UseGuards(AccessTokenGuard)
export class ArchiveController {
  constructor(private readonly archive: ArchiveService) {}

  @Get('fields') list(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string) {
    return this.archive.list(user.userId, householdId);
  }

  @Post('fields') create(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Body() dto: CreateArchiveFieldDto) {
    return this.archive.createField(user.userId, householdId, dto);
  }

  @Patch('fields/:fieldId') update(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('fieldId') fieldId: string, @Body() dto: UpdateArchiveFieldDto) {
    return this.archive.updateField(user.userId, householdId, fieldId, dto);
  }

  @Post('fields/:fieldId/archive') archiveField(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('fieldId') fieldId: string, @Body() dto: ArchiveFieldVersionDto) {
    return this.archive.archiveField(user.userId, householdId, fieldId, dto);
  }

  @Get('fields/:fieldId/value') value(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('fieldId') fieldId: string) {
    return this.archive.readValue(user.userId, householdId, fieldId);
  }

  @Put('fields/:fieldId/value') setValue(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('fieldId') fieldId: string, @Body() dto: SetArchiveValueDto) {
    return this.archive.setValue(user.userId, householdId, fieldId, dto);
  }
}
