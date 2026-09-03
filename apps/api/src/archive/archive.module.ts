import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ArchiveController } from './archive.controller';
import { ArchiveService } from './archive.service';

@Module({ imports: [AuthModule], controllers: [ArchiveController], providers: [ArchiveService] })
export class ArchiveModule {}
