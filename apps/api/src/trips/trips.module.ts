import { Module } from '@nestjs/common';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';
import { AuthModule } from '../auth/auth.module';
import { ItineraryController } from './itinerary.controller';
import { ItineraryService } from './itinerary.service';

@Module({ imports: [AuthModule], controllers: [TripsController, ItineraryController], providers: [TripsService, ItineraryService] })
export class TripsModule {}
