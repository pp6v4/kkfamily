import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PackingController } from './packing.controller';
import { PackingService } from './packing.service';

@Module({ imports: [AuthModule], controllers: [PackingController], providers: [PackingService] })
export class PackingModule {}
