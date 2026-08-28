import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MealsController } from './meals.controller';
import { MealsService } from './meals.service';

@Module({ imports: [AuthModule], controllers: [MealsController], providers: [MealsService] })
export class MealsModule {}
