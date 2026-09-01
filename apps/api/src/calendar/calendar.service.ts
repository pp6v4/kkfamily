import { BadRequestException, Injectable } from '@nestjs/common';
import { AccessService } from '../access/access.service';
import { permits } from '../access/permission-policy';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto';
import { ListCalendarEventsDto } from './dto/list-calendar-events.dto';

@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService) {}

  async list(userId: string, householdId: string, query: ListCalendarEventsDto) {
    const member = await this.access.require(userId, householdId, 'calendar');
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (Number.isNaN(from.valueOf()) || Number.isNaN(to.valueOf()) || from >= to) throw new BadRequestException('Invalid calendar range');
    if (to.getTime() - from.getTime() > 370 * 86400_000) throw new BadRequestException('查询范围不能超过370天');
    // Derive linked events from authorized source rows, never trust a stale projection.
    const [anniversaries, meals, trips] = await Promise.all([
      this.prisma.calendarEvent.findMany({ where: { householdId, type: 'ANNIVERSARY', sourceId: null, sourceType: null, startsAt: { lt: to }, OR: [{ endsAt: { gt: from } }, { startsAt: { gte: from } }] }, orderBy: { startsAt: 'asc' } }),
      permits(member.effectivePermissions, 'meals') ? this.prisma.meal.findMany({ where: { householdId, scheduledAt: { gte: from, lt: to }, status: { not: 'CANCELLED' } } }) : [],
      permits(member.effectivePermissions, 'trips') ? this.prisma.trip.findMany({ where: { householdId, status: { not: 'CANCELLED' }, members: { some: { membershipId: member.id } }, startsAt: { lt: to }, OR: [{ endsAt: { gt: from } }, { startsAt: { gte: from } }] } }) : [],
    ]);
    return { data: [
      ...anniversaries,
      ...meals.map(meal => ({ id: `meal:${meal.id}`, type: 'MEAL', title: (({ BREAKFAST: '早餐', LUNCH: '午餐', DINNER: '晚餐', OTHER: '加餐' } as Record<string, string>)[meal.mealType] ?? meal.mealType) + (meal.slotKey ? ` · ${meal.slotKey}` : ''), startsAt: meal.scheduledAt, endsAt: null, sourceType: 'MEAL', sourceId: meal.id })),
      ...trips.map(trip => ({ id: `trip:${trip.id}`, type: 'TRIP', title: trip.title, startsAt: trip.startsAt, endsAt: trip.endsAt, sourceType: 'TRIP', sourceId: trip.id })),
    ].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id)) };
  }

  async create(userId: string, householdId: string, dto: CreateCalendarEventDto) {
    await this.access.require(userId, householdId, 'calendar', 'EDIT');
    if (dto.type !== 'ANNIVERSARY' || dto.sourceType || dto.sourceId) throw new BadRequestException('餐点、行程和待办请从对应功能创建，不能只创建日历占位');
    if (!dto.title.trim()) throw new BadRequestException('标题不能为空');
    const startsAt = new Date(dto.startsAt);
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : undefined;
    if (Number.isNaN(startsAt.valueOf()) || (endsAt && Number.isNaN(endsAt.valueOf())) || (endsAt && endsAt < startsAt)) {
      throw new BadRequestException('Invalid event time range');
    }
    return { data: await this.prisma.calendarEvent.create({
      data: {
        householdId, type: dto.type, title: dto.title.trim(), startsAt, endsAt,
        sourceType: dto.sourceType?.trim(), sourceId: dto.sourceId?.trim(), createdById: userId,
      },
    }) };
  }

}
