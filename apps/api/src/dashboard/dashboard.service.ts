import { BadRequestException, Injectable } from '@nestjs/common';
import { AccessService } from '../access/access.service';
import { permits } from '../access/permission-policy';
import { PrismaService } from '../prisma/prisma.service';
import { DashboardRangeDto } from './dashboard.dto';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService) {}

  async summary(userId: string, householdId: string, query: DashboardRangeDto) {
    const member = await this.access.require(userId, householdId, 'dashboard');
    const from = new Date(query.from), to = new Date(query.to);
    if (Number.isNaN(from.valueOf()) || Number.isNaN(to.valueOf()) || from >= to) throw new BadRequestException('看板时间范围无效');
    if (to.getTime() - from.getTime() > 366 * 86400_000) throw new BadRequestException('看板时间范围最多366天');
    const result: Record<string, unknown> = { from: from.toISOString(), to: to.toISOString() };

    if (permits(member.effectivePermissions, 'recipes')) {
      result.recipes = { publishedCount: await this.prisma.recipe.count({ where: { householdId, status: 'PUBLISHED' } }) };
    }
    if (permits(member.effectivePermissions, 'meals')) {
      const completedCount = await this.prisma.meal.count({ where: { householdId, status: 'COMPLETED', scheduledAt: { gte: from, lt: to } } });
      const selected = await this.prisma.mealDish.groupBy({ by: ['recipeId'], where: { meal: { householdId, status: 'COMPLETED', scheduledAt: { gte: from, lt: to } } }, _count: { _all: true }, orderBy: [{ _count: { recipeId: 'desc' } }, { recipeId: 'asc' }], take: 5 });
      const recipeNames = await this.prisma.recipe.findMany({ where: { householdId, id: { in: selected.map(item => item.recipeId) } }, select: { id: true, name: true } });
      const names = new Map(recipeNames.map(recipe => [recipe.id, recipe.name]));
      result.meals = { completedCount, frequentRecipes: selected.map(item => ({ recipeId: item.recipeId, name: names.get(item.recipeId) || '已删除菜谱', mealCount: item._count._all })) };
    }
    if (permits(member.effectivePermissions, 'shopping')) {
      const grouped = await this.prisma.shoppingItem.groupBy({ by: ['status'], where: { list: { householdId }, status: { in: ['WISHLIST', 'NEXT_TRIP', 'REPLENISH'] } }, _count: { _all: true } });
      const counts = { WISHLIST: 0, NEXT_TRIP: 0, REPLENISH: 0 };
      for (const item of grouped) counts[item.status as keyof typeof counts] = item._count._all;
      result.shopping = { pendingCount: Object.values(counts).reduce((sum, count) => sum + count, 0), counts };
    }
    if (permits(member.effectivePermissions, 'trips')) {
      const tripMemberships = await this.prisma.tripMember.findMany({ where: { membershipId: member.id, status: { in: ['ACTIVE', 'HISTORY'] }, trip: { householdId, startsAt: { lt: to }, OR: [{ endsAt: { gt: from } }, { endsAt: null, startsAt: { gte: from } }] } }, select: { tripId: true } });
      const tripIds = tripMemberships.map(item => item.tripId);
      const pendingPackingCount = tripIds.length ? await this.prisma.tripPackingItem.count({ where: { tripId: { in: tripIds }, status: 'PENDING', excludedAt: null } }) : 0;
      result.trips = { visibleTripCount: tripIds.length, pendingPackingCount };
    }
    if (permits(member.effectivePermissions, 'tasks')) {
      const base = { householdId, archivedAt: null, createdAt: { gte: from, lt: to }, status: { not: 'CANCELLED' as const } };
      const [total, completed] = await Promise.all([this.prisma.task.count({ where: base }), this.prisma.task.count({ where: { ...base, status: 'COMPLETED' } })]);
      result.tasks = { completed, total, completionRate: total ? completed / total : null };
    }
    return { data: result };
  }
}
