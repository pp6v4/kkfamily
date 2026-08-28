import { IsBoolean } from 'class-validator';

export class CompleteMealDto {
  @IsBoolean()
  deductInventory!: boolean;
}
