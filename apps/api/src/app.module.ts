import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as Joi from 'joi';
import { AuthModule } from './auth/auth.module';
import { HouseholdsModule } from './households/households.module';
import { RecipesModule } from './recipes/recipes.module';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { CalendarModule } from './calendar/calendar.module';
import { MealsModule } from './meals/meals.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        PORT: Joi.number().default(3000),
        DATABASE_URL: Joi.string().uri({ scheme: ['postgresql'] }).required(),
        JWT_ACCESS_SECRET: Joi.string().min(32).required(),
        WECHAT_APP_ID: Joi.string().allow(''),
        WECHAT_APP_SECRET: Joi.string().allow(''),
      }),
    }),
    PrismaModule,
    AuthModule,
    HouseholdsModule,
    RecipesModule,
    CalendarModule,
    MealsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
