import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto';
import { ListCalendarEventsDto } from './dto/list-calendar-events.dto';

@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, householdId: string, query: ListCalendarEventsDto) {
    await this.requireMember(userId, householdId);
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (Number.isNaN(from.valueOf()) || Number.isNaN(to.valueOf()) || from >= to) throw new BadRequestException('Invalid calendar range');
    return { data: await this.prisma.calendarEvent.findMany({
      where: { householdId, startsAt: { gte: from, lt: to } },
      orderBy: [{ startsAt: 'asc' }, { createdAt: 'asc' }],
    }) };
  }

  async create(userId: string, householdId: string, dto: CreateCalendarEventDto) {
    await this.requireMember(userId, householdId);
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

  private async requireMember(userId: string, householdId: string) {
    const membership = await this.prisma.membership.findFirst({ where: { householdId, userId, status: 'ACTIVE' } });
    if (!membership) throw new ForbiddenException('No access to this household');
    return membership;
  }
}
