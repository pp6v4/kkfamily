import { MediaOwnerType } from '@prisma/client';
import { IsEnum, IsIn, IsInt, IsString, Max, Min } from 'class-validator';
import { TrimText } from '../../common/trim-text';

export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export class CreateUploadIntentDto {
  @IsEnum(MediaOwnerType) ownerType!: MediaOwnerType;
  @TrimText() @IsString() ownerId!: string;
  @IsInt() @Min(1) expectedOwnerVersion!: number;
  @IsIn(SUPPORTED_IMAGE_TYPES) mimeType!: typeof SUPPORTED_IMAGE_TYPES[number];
  @IsInt() @Min(1) @Max(MAX_IMAGE_BYTES) byteSize!: number;
}
