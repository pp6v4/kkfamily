import { BadGatewayException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { serializable } from '../prisma/serializable';

interface Code2SessionResponse { openid?: string; unionid?: string; errcode?: number; errmsg?: string; }

const profileInclude = { memberships: { include: { household: true, roles: { include: { role: true } } } } } as const;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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
    let response: Response;
    try { response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${query.toString()}`, { signal: AbortSignal.timeout(10_000) }); }
    catch { throw new BadGatewayException('WeChat login request failed'); }
    if (!response.ok) throw new BadGatewayException('WeChat login request failed');
    const body = (await response.json()) as Code2SessionResponse;
    if (!body.openid) throw new BadGatewayException(body.errmsg ?? 'WeChat login was rejected');

    const user = await this.prisma.user.upsert({
      where: { openId: body.openid },
      update: {},
      create: { openId: body.openid },
      include: profileInclude,
    });
    const tokens = await this.issueNewSession(user.id, user.openId);
    return { data: { ...tokens, user: this.profileFrom(user) } };
  }

  async refresh(refreshToken: string) {
    const presentedHash = this.hash(refreshToken);
    const nextToken = this.newRefreshToken();
    const now = new Date();
    const outcome = await serializable(this.prisma, async tx => {
      const current = await tx.authSession.findUnique({ where: { refreshHash: presentedHash } });
      if (!current || current.revokedAt || current.expiresAt <= now) return { kind: 'INVALID' as const };
      if (current.consumedAt) {
        await tx.authSession.updateMany({ where: { userId: current.userId, familyId: current.familyId, revokedAt: null }, data: { revokedAt: now } });
        return { kind: 'REUSED' as const };
      }
      const next = await tx.authSession.create({ data: {
        userId: current.userId,
        familyId: current.familyId,
        refreshHash: this.hash(nextToken),
        expiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
      } });
      const changed = await tx.authSession.updateMany({
        where: { id: current.id, consumedAt: null, revokedAt: null },
        data: { consumedAt: now, rotatedToId: next.id },
      });
      if (changed.count !== 1) {
        await tx.authSession.updateMany({ where: { userId: current.userId, familyId: current.familyId, revokedAt: null }, data: { revokedAt: now } });
        return { kind: 'REUSED' as const };
      }
      const user = await tx.user.findUnique({ where: { id: current.userId }, include: profileInclude });
      if (!user) return { kind: 'INVALID' as const };
      return { kind: 'OK' as const, user };
    });
    if (outcome.kind !== 'OK') throw new UnauthorizedException(outcome.kind === 'REUSED' ? 'Refresh token reuse detected; session revoked' : 'Invalid or expired refresh token');
    const accessToken = await this.jwt.signAsync({ sub: outcome.user.id, openId: outcome.user.openId });
    return { data: { accessToken, refreshToken: nextToken, user: this.profileFrom(outcome.user) } };
  }

  async logout(refreshToken: string) {
    await this.prisma.authSession.updateMany({ where: { refreshHash: this.hash(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
    return { data: { loggedOut: true } };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: profileInclude });
    return { data: { user: this.profileFrom(user) } };
  }

  async updateProfile(userId: string, nickname: string) {
    const user = await this.prisma.user.update({ where: { id: userId }, data: { nickname: nickname.trim() }, include: profileInclude });
    return { data: { user: this.profileFrom(user) } };
  }

  private async issueNewSession(userId: string, openId: string) {
    const refreshToken = this.newRefreshToken();
    await this.prisma.authSession.create({ data: {
      userId,
      familyId: randomUUID(),
      refreshHash: this.hash(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    } });
    return { accessToken: await this.jwt.signAsync({ sub: userId, openId }), refreshToken };
  }

  private newRefreshToken() { return randomBytes(48).toString('base64url'); }
  private hash(token: string) { return createHash('sha256').update(token).digest('hex'); }

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
