import { Controller, Get, Headers, Param, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';
import { MediaService } from './media.service';

@Controller('trips')
@UseGuards(AccessTokenGuard)
export class TripPhotosController {
  constructor(private readonly media: MediaService) {}

  @Get(':tripId/photos')
  list(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('tripId') tripId: string) {
    return this.media.listTripPhotos(user.userId, householdId, tripId);
  }
}
