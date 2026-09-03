import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Anniversary, AnniversaryLeapPolicy, AnniversaryRecurrence, Prisma } from '@prisma/client';
import { AccessService } from '../access/access.service';
import { permits } from '../access/permission-policy';
import { PrismaService } from '../prisma/prisma.service';
import { serializable } from '../prisma/serializable';
import { ArchiveAnniversaryDto, CreateAnniversaryDto, UpdateAnniversaryDto } from './dto/anniversary.dto';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto';
import { ListCalendarEventsDto } from './dto/list-calendar-events.dto';

const DAY_MS = 86_400_000;

@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService) {}

  async list(userId: string, householdId: string, query: ListCalendarEventsDto) {
    const member = await this.access.require(userId, householdId, 'calendar');
    const { from, to } = this.range(query);
    // Derive linked events from authorized source rows, never trust a stale projection.
    const [anniversaries, legacyAnniversaries, meals, trips, tasks] = await Promise.all([
      this.prisma.anniversary.findMany({ where: { householdId, archivedAt: null }, orderBy: [{ localDate: 'asc' }, { id: 'asc' }] }),
      this.prisma.calendarEvent.findMany({ where: { householdId, type: 'ANNIVERSARY', sourceId: null, sourceType: null, startsAt: { lt: to }, OR: [{ endsAt: { gt: from } }, { startsAt: { gte: from } }] }, orderBy: { startsAt: 'asc' } }),
      permits(member.effectivePermissions, 'meals') ? this.prisma.meal.findMany({ where: { householdId, scheduledAt: { gte: from, lt: to }, status: { not: 'CANCELLED' } } }) : [],
      permits(member.effectivePermissions, 'trips') ? this.prisma.trip.findMany({ where: { householdId, status: { not: 'CANCELLED' }, members: { some: { membershipId: member.id, status: { in: ['ACTIVE', 'HISTORY'] } } }, startsAt: { lt: to }, OR: [{ endsAt: { gt: from } }, { startsAt: { gte: from } }] } }) : [],
      permits(member.effectivePermissions, 'tasks') ? this.prisma.task.findMany({ where: { householdId, archivedAt: null, status: { not: 'CANCELLED' }, dueAt: { gte: from, lt: to } } }) : [],
    ]);
    return { data: [
      ...anniversaries.flatMap(item => this.occurrences(item, from, to)),
      ...legacyAnniversaries,
      ...meals.map(meal => ({ id: `meal:${meal.id}`, type: 'MEAL', title: (({ BREAKFAST: '早餐', LUNCH: '午餐', DINNER: '晚餐', OTHER: '加餐' } as Record<string, string>)[meal.mealType] ?? meal.mealType) + (meal.slotKey ? ` · ${meal.slotKey}` : ''), startsAt: meal.scheduledAt, endsAt: null, sourceType: 'MEAL', sourceId: meal.id })),
      ...trips.map(trip => ({ id: `trip:${trip.id}`, type: 'TRIP', title: trip.title, startsAt: trip.startsAt, endsAt: trip.endsAt, sourceType: 'TRIP', sourceId: trip.id })),
      ...tasks.map(task => ({ id: `task:${task.id}`, type: 'TASK', title: task.title, startsAt: task.dueAt!, endsAt: null, sourceType: 'TASK', sourceId: task.id })),
    ].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id)) };
  }

  async listAnniversaries(userId: string, householdId: string) {
    await this.access.require(userId, householdId, 'calendar');
    return { data: await this.prisma.anniversary.findMany({ where: { householdId, archivedAt: null }, orderBy: [{ localDate: 'asc' }, { id: 'asc' }] }) };
  }

  async createAnniversary(userId: string, householdId: string, dto: CreateAnniversaryDto) {
    this.assertLocalDate(dto.localDate);
    return { data: await serializable(this.prisma, async tx => {
      const actor = await this.access.require(userId, householdId, 'calendar', 'EDIT', tx);
      const anniversary = await tx.anniversary.create({ data: {
        householdId,
        title: dto.title.trim(),
        localDate: dto.localDate,
        recurrence: dto.recurrence,
        leapPolicy: dto.leapPolicy ?? AnniversaryLeapPolicy.FEB_28,
        note: dto.note?.trim() || null,
        createdById: actor.id,
      } });
      await this.audit(tx, householdId, actor.id, 'ANNIVERSARY_CREATE', anniversary.id, { recurrence: anniversary.recurrence, localDate: anniversary.localDate });
      return anniversary;
    }) };
  }

  async updateAnniversary(userId: string, householdId: string, anniversaryId: string, dto: UpdateAnniversaryDto) {
    if (dto.localDate) this.assertLocalDate(dto.localDate);
    return { data: await serializable(this.prisma, async tx => {
      const actor = await this.access.require(userId, householdId, 'calendar', 'EDIT', tx);
      const current = await this.anniversaryOrThrow(tx, householdId, anniversaryId);
      if (current.version !== dto.expectedVersion) throw new ConflictException('纪念日已更新，请刷新后重试');
      const changed = await tx.anniversary.updateMany({ where: { id: anniversaryId, householdId, archivedAt: null, version: dto.expectedVersion }, data: {
        title: dto.title?.trim(),
        localDate: dto.localDate,
        recurrence: dto.recurrence,
        leapPolicy: dto.leapPolicy,
        note: dto.note === undefined ? undefined : dto.note?.trim() || null,
        version: { increment: 1 },
      } });
      if (!changed.count) throw new ConflictException('纪念日已更新，请刷新后重试');
      await this.audit(tx, householdId, actor.id, 'ANNIVERSARY_UPDATE', anniversaryId, { fromVersion: current.version });
      return this.anniversaryOrThrow(tx, householdId, anniversaryId);
    }) };
  }

  async archiveAnniversary(userId: string, householdId: string, anniversaryId: string, dto: ArchiveAnniversaryDto) {
    return { data: await serializable(this.prisma, async tx => {
      const actor = await this.access.require(userId, householdId, 'calendar', 'EDIT', tx);
      const current = await this.anniversaryOrThrow(tx, householdId, anniversaryId);
      if (current.version !== dto.expectedVersion) throw new ConflictException('纪念日已更新，请刷新后重试');
      const changed = await tx.anniversary.updateMany({ where: { id: anniversaryId, householdId, archivedAt: null, version: dto.expectedVersion }, data: { archivedAt: new Date(), version: { increment: 1 } } });
      if (!changed.count) throw new ConflictException('纪念日已更新，请刷新后重试');
      await this.audit(tx, householdId, actor.id, 'ANNIVERSARY_ARCHIVE', anniversaryId, { fromVersion: current.version });
      return { id: anniversaryId, archived: true };
    }) };
  }

  /** Compatibility for an older client build. New clients use /calendar/anniversaries. */
  async create(userId: string, householdId: string, dto: CreateCalendarEventDto) {
    if (dto.type !== 'ANNIVERSARY' || dto.sourceType || dto.sourceId) throw new BadRequestException('餐点、行程和待办请从对应功能创建，不能只创建日历占位');
    const startsAt = new Date(dto.startsAt);
    if (Number.isNaN(startsAt.valueOf())) throw new BadRequestException('纪念日日期无效');
    return this.createAnniversary(userId, householdId, {
      title: dto.title,
      localDate: this.shanghaiDateKey(startsAt),
      recurrence: AnniversaryRecurrence.ONCE,
      leapPolicy: AnniversaryLeapPolicy.FEB_28,
    });
  }

  private range(query: ListCalendarEventsDto) {
    const from = new Date(query.from), to = new Date(query.to);
    if (Number.isNaN(from.valueOf()) || Number.isNaN(to.valueOf()) || from >= to) throw new BadRequestException('Invalid calendar range');
    if (to.getTime() - from.getTime() > 370 * DAY_MS) throw new BadRequestException('查询范围不能超过370天');
    return { from, to };
  }

  private occurrences(item: Anniversary, from: Date, to: Date) {
    const years = item.recurrence === AnniversaryRecurrence.ONCE
      ? [Number(item.localDate.slice(0, 4))]
      : this.yearsBetween(from, to);
    return years.flatMap(year => {
      const occurrenceKey = item.recurrence === AnniversaryRecurrence.ONCE ? item.localDate : this.annualDateKey(item.localDate, year, item.leapPolicy);
      if (!occurrenceKey) return [];
      const startsAt = this.instantForLocalDate(occurrenceKey);
      if (startsAt < from || startsAt >= to) return [];
      return [{
        id: `anniversary:${item.id}:${occurrenceKey}`,
        type: 'ANNIVERSARY' as const,
        title: item.title,
        startsAt,
        endsAt: null,
        sourceType: 'ANNIVERSARY',
        sourceId: item.id,
        localDate: item.localDate,
        occurrenceDate: occurrenceKey,
        recurrence: item.recurrence,
        leapPolicy: item.leapPolicy,
        note: item.note,
        version: item.version,
      }];
    });
  }

  private yearsBetween(from: Date, to: Date) {
    const first = Number(this.shanghaiDateKey(from).slice(0, 4));
    const last = Number(this.shanghaiDateKey(new Date(to.getTime() - 1)).slice(0, 4));
    return Array.from({ length: last - first + 1 }, (_, index) => first + index);
  }

  private annualDateKey(anchor: string, year: number, policy: AnniversaryLeapPolicy) {
    const monthDay = anchor.slice(5);
    if (monthDay !== '02-29' || this.isLeapYear(year)) return `${year}-${monthDay}`;
    if (policy === AnniversaryLeapPolicy.SKIP) return null;
    return policy === AnniversaryLeapPolicy.MAR_1 ? `${year}-03-01` : `${year}-02-28`;
  }

  private assertLocalDate(value: string) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) throw new BadRequestException('纪念日日期必须为YYYY-MM-DD');
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new BadRequestException('纪念日日期无效');
  }

  private instantForLocalDate(value: string) { return new Date(`${value}T00:00:00+08:00`); }
  private shanghaiDateKey(value: Date) { return new Date(value.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10); }
  private isLeapYear(year: number) { return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0); }

  private async anniversaryOrThrow(tx: Prisma.TransactionClient | PrismaService, householdId: string, anniversaryId: string) {
    const anniversary = await tx.anniversary.findFirst({ where: { id: anniversaryId, householdId, archivedAt: null } });
    if (!anniversary) throw new NotFoundException('纪念日不存在');
    return anniversary;
  }

  private audit(tx: Prisma.TransactionClient, householdId: string, actorMembershipId: string, action: string, targetId: string, details: Prisma.InputJsonObject) {
    return tx.auditLog.create({ data: { householdId, actorMembershipId, action, targetId, details } });
  }
}
