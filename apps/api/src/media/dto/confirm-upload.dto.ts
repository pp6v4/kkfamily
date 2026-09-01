import { IsString, Matches } from 'class-validator';
import { TrimText } from '../../common/trim-text';

export class ConfirmUploadDto {
  @TrimText() @IsString() intentId!: string;
  @Matches(/^[a-f0-9]{64}$/) checksumSha256!: string;
}
