import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HouseholdsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, name: string) {
    const household = await this.prisma.$transaction(async (tx) => {
      const household = await tx.household.create({ data: { name } });
      const membership = await tx.membership.create({ data: { householdId: household.id, userId, status: 'ACTIVE' } });
      const admin = await tx.role.upsert({ where: { code: 'ADMIN' }, update: { name: '管理员' }, create: { code: 'ADMIN', name: '管理员' } });
      await tx.memberRole.create({ data: { membershipId: membership.id, roleId: admin.id } });
      return { ...household, membershipId: membership.id };
    });
    return { data: household };
  }
}
