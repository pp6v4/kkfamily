import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, RequestUser } from './current-user.decorator';
import { AccessTokenGuard } from './access-token.guard';
import { AuthService } from './auth.service';
import { WechatLoginDto } from './dto/wechat-login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('wechat/login')
  login(@Body() dto: WechatLoginDto) {
    return this.authService.loginWithWechatCode(dto.code);
  }

  @Get('me')
  @UseGuards(AccessTokenGuard)
  me(@CurrentUser() user: RequestUser) {
    return this.authService.getProfile(user.userId);
  }
}

