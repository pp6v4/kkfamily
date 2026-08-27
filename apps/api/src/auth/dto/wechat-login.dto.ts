import { IsString, Length } from 'class-validator';

export class WechatLoginDto {
  @IsString()
  @Length(1, 256)
  code!: string;
}

