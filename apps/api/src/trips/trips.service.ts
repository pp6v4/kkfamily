import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTripDto } from './dto/create-trip.dto';

@Injectable()
export class TripsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, householdId: string) {
    const membership = await this.requireMember(userId, householdId);
    return { data: await this.prisma.trip.findMany({
      where: { householdId, members: { some: { membershipId: membership.id } } },
      include: { members: true }, orderBy: { startsAt: 'desc' },
    }) };
  }

  async create(userId: string, householdId: string, dto: CreateTripDto) {
    const membership = await this.requireMember(userId, householdId);
    const startsAt = new Date(dto.startsAt);
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : undefined;
    if (Number.isNaN(startsAt.valueOf()) || (endsAt && (Number.isNaN(endsAt.valueOf()) || endsAt < startsAt))) throw new BadRequestException('Invalid trip time range');
    const trip = await this.prisma.$transaction(async (tx) => {
      const created = await tx.trip.create({ data: { householdId, title: dto.title.trim(), startsAt, endsAt, destination: dto.destination?.trim(), members: { create: { membershipId: membership.id, canEdit: true } } }, include: { members: true } });
      await tx.calendarEvent.create({ data: { householdId, type: 'TRIP', title: created.title, startsAt, endsAt, sourceType: 'TRIP', sourceId: created.id, createdById: userId } });
      return created;
    });
    return { data: trip };
  }

  private async requireMember(userId: string, householdId: string) {
    const membership = await this.prisma.membership.findFirst({ where: { householdId, userId, status: 'ACTIVE' } });
    if (!membership) throw new ForbiddenException('No access to this household');
    return membership;
  }
}
