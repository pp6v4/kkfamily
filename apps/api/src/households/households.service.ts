import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HouseholdsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, name: string) {
    name = name.trim();
    if (!name) throw new BadRequestException('家庭名称不能为空');
    const household = await this.prisma.$transaction(async (tx) => {
      const household = await tx.household.create({ data: { name } });
      const membership = await tx.membership.create({ data: { householdId: household.id, userId, status: 'ACTIVE' } });
      const admin = await tx.role.upsert({ where: { code: 'ADMIN' }, update: { name: '管理员' }, create: { code: 'ADMIN', name: '管理员' } });
      await tx.memberRole.create({ data: { membershipId: membership.id, roleId: admin.id } });
      await tx.recipeCategory.createMany({
        data: ['主食', '炒菜', '炖菜', '海鲜', '汤羹', '其他'].map((categoryName, index) => ({
          householdId: household.id,
          name: categoryName,
          sortOrder: index,
        })),
      });
      return { ...household, membershipId: membership.id };
    });
    return { data: household };
  }
}
