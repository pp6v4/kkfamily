import { TrimText } from '../../common/trim-text';
import { IsString, Length } from 'class-validator';

export class WechatLoginDto {
  @TrimText() @IsString()
  @Length(1, 256)
  code!: string;
}

