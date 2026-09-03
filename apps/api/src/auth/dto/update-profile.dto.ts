import { IsString, Length } from 'class-validator';
import { TrimText } from '../../common/trim-text';

export class UpdateProfileDto {
  @TrimText() @IsString() @Length(1, 30)
  nickname!: string;
}
