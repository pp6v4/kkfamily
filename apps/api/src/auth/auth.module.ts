import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccessTokenGuard } from './access-token.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        // @nestjs/jwt v11 narrows string durations to a template-literal type.
        // Use seconds here so the value remains unambiguous to both TypeScript and JWT.
        signOptions: { expiresIn: 15 * 60 },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AccessTokenGuard],
  exports: [AuthService, AccessTokenGuard, JwtModule],
})
export class AuthModule {}

