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
import { ShoppingModule } from './shopping/shopping.module';
import { InventoryModule } from './inventory/inventory.module';
import { TripsModule } from './trips/trips.module';
import { PackingModule } from './packing/packing.module';
import { AccessModule } from './access/access.module';
import { MembersModule } from './members/members.module';
import { MediaModule } from './media/media.module';

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
        NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
        MEDIA_DRIVER: Joi.string().valid('disabled', 'memory', 'cos').default('disabled'),
        COS_BUCKET: Joi.string().default('family-life-pp6v4-1303887403'),
        COS_REGION: Joi.string().default('ap-beijing'),
        COS_SECRET_ID: Joi.string().when('MEDIA_DRIVER', { is: 'cos', then: Joi.required(), otherwise: Joi.allow('') }),
        COS_SECRET_KEY: Joi.string().when('MEDIA_DRIVER', { is: 'cos', then: Joi.required(), otherwise: Joi.allow('') }),
      }),
    }),
    PrismaModule,
    AccessModule,
    MembersModule,
    AuthModule,
    HouseholdsModule,
    RecipesModule,
    CalendarModule,
    MealsModule,
    ShoppingModule,
    InventoryModule,
    TripsModule,
    PackingModule,
    MediaModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
