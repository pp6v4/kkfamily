import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

interface Code2SessionResponse { openid?: string; unionid?: string; errcode?: number; errmsg?: string; }

@Injectable()
export class AuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async loginWithWechatCode(code: string) {
    const appId = this.config.get<string>('WECHAT_APP_ID');
    const secret = this.config.get<string>('WECHAT_APP_SECRET');
    if (!appId || !secret) throw new BadGatewayException('WeChat login is not configured');

    const query = new URLSearchParams({ appid: appId, secret, js_code: code, grant_type: 'authorization_code' });
    const response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${query.toString()}`);
    if (!response.ok) throw new BadGatewayException('WeChat login request failed');
    const body = (await response.json()) as Code2SessionResponse;
    if (!body.openid) throw new BadGatewayException(body.errmsg ?? 'WeChat login was rejected');

    const user = await this.prisma.user.upsert({
      where: { openId: body.openid },
      update: {},
      create: { openId: body.openid },
      include: { memberships: { include: { household: true, roles: { include: { role: true } } } } },
    });
    const accessToken = await this.jwt.signAsync({ sub: user.id, openId: user.openId });
    return { data: { accessToken, user: this.profileFrom(user) } };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { memberships: { include: { household: true, roles: { include: { role: true } } } } },
    });
    return { data: { user: this.profileFrom(user) } };
  }

  private profileFrom(user: { id: string; nickname: string | null; avatarUrl: string | null; memberships: Array<{ id: string; status: string; household: { id: string; name: string }; roles: Array<{ role: { code: string } }> }> }) {
    return {
      id: user.id, nickname: user.nickname, avatarUrl: user.avatarUrl,
      households: user.memberships.map((member) => ({
        membershipId: member.id, household: member.household, status: member.status,
        roles: member.roles.map((entry) => entry.role.code),
      })),
    };
  }
}

