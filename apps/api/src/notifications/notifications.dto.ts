import { NotificationEventType, SubscriptionResult } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { TrimText } from '../common/trim-text';

export class UpdateNotificationPreferenceDto {
  @IsEnum(NotificationEventType)
  eventType!: NotificationEventType;

  @IsInt() @Min(0)
  expectedVersion!: number;

  @IsBoolean()
  enabled!: boolean;

  @IsInt() @Min(0) @Max(525600)
  leadMinutes!: number;

  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  quietStart?: string | null;

  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  quietEnd?: string | null;
}

export class ReadInboxItemDto {
  @IsInt() @Min(1)
  expectedVersion!: number;
}

export class RecordSubscriptionReceiptDto {
  @TrimText() @IsString() @Length(1, 160)
  templateId!: string;

  @IsEnum(SubscriptionResult)
  result!: SubscriptionResult;

  @IsOptional() @TrimText() @IsString() @Length(0, 80)
  clientScene?: string;
}
