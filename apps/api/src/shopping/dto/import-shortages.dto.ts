import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsInt, IsString, Length, Min } from 'class-validator';
import { TrimText } from '../../common/trim-text';

export class ImportShortagesDto {
  @TrimText() @IsString() @Length(1, 80) mealId!: string;
  @IsInt() @Min(1) snapshotVersion!: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) @Length(1, 200, { each: true })
  selectedRequirementIds!: string[];
}
