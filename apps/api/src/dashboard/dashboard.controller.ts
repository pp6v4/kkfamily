import { Controller, Get, Headers, Query, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';
import { DashboardRangeDto } from './dashboard.dto';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(AccessTokenGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  summary(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Query() query: DashboardRangeDto) {
    return this.dashboard.summary(user.userId, householdId, query);
  }
}
