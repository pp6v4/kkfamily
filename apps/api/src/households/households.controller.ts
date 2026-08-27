import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';
import { CreateHouseholdDto } from './dto/create-household.dto';
import { HouseholdsService } from './households.service';

@Controller('households')
@UseGuards(AccessTokenGuard)
export class HouseholdsController {
  constructor(private readonly householdsService: HouseholdsService) {}

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateHouseholdDto) {
    return this.householdsService.create(user.userId, dto.name);
  }
}

