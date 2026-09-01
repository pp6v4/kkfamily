import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { effectivePermissions, Level, ModuleCode, permits } from './permission-policy';

export function householdIdOrThrow(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) throw new BadRequestException('有效的X-Household-Id不能为空');
}

@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  async member(userId: string, householdId: string, db: Prisma.TransactionClient = this.prisma) {
    householdIdOrThrow(householdId);
    const member = await db.membership.findFirst({ where: { householdId, userId, status: 'ACTIVE' }, include: { roles: { include: { role: true } }, permissions: true } });
    if (!member) throw new ForbiddenException('当前账号没有该家庭的访问权限');
    return { ...member, effectivePermissions: effectivePermissions(member.roles.map(r => r.role.code), member.permissions) };
  }

  async require(userId: string, householdId: string, module: ModuleCode, level: Level = 'VIEW', db: Prisma.TransactionClient = this.prisma) {
    const member = await this.member(userId, householdId, db);
    if (!permits(member.effectivePermissions, module, level)) throw new ForbiddenException(`当前账号没有${module}的${level}权限`);
    return member;
  }
}
