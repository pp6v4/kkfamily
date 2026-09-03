import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationScheduleService } from './notification-schedule.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({ imports: [AuthModule], controllers: [NotificationsController], providers: [NotificationsService, NotificationScheduleService], exports: [NotificationsService, NotificationScheduleService] })
export class NotificationsModule {}
