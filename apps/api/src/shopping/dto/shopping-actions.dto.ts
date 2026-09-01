import { IsString, Length } from 'class-validator';
import { TrimText } from '../../common/trim-text';
export class RepeatShoppingItemDto {
  @TrimText() @IsString() @Length(8, 80) requestId!: string;
}
