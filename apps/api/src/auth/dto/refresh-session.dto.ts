import { IsString, Length } from 'class-validator';
import { TrimText } from '../../common/trim-text';

export class RefreshSessionDto {
  @TrimText() @IsString() @Length(32, 256)
  refreshToken!: string;
}
