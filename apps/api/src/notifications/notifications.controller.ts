import { Body, Controller, Get, Headers, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';
import { ReadInboxItemDto, RecordSubscriptionReceiptDto, UpdateNotificationPreferenceDto } from './notifications.dto';
import { NotificationsService } from './notifications.service';

@Controller()
@UseGuards(AccessTokenGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('inbox') list(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string) { return this.notifications.listInbox(user.userId, householdId); }
  @Patch('inbox/:itemId/read') read(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('itemId') itemId: string, @Body() dto: ReadInboxItemDto) { return this.notifications.markRead(user.userId, householdId, itemId, dto); }
  @Get('notification-preferences') preferences(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string) { return this.notifications.preferences(user.userId, householdId); }
  @Patch('notification-preferences') updatePreference(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Body() dto: UpdateNotificationPreferenceDto) { return this.notifications.updatePreference(user.userId, householdId, dto); }
  @Get('notification-settings/public') publicSettings(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string) { return this.notifications.publicSettings(user.userId, householdId); }
  @Post('subscriptions/receipts') receipt(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Body() dto: RecordSubscriptionReceiptDto) { return this.notifications.recordReceipt(user.userId, householdId, dto); }
}
