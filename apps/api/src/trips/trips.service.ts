import { AccessService } from '../access/access.service';
import { Level, permits } from '../access/permission-policy';
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTripDto } from './dto/create-trip.dto';

@Injectable()
export class TripsService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService) {}

  async list(userId: string, householdId: string) {
    const membership = await this.requireMember(userId, householdId);
    return { data: await this.prisma.trip.findMany({
      where: { householdId, members: { some: { membershipId: membership.id } } },
      include: { members: { include: { membership: { include: { user: { select: { id: true, nickname: true, avatarUrl: true } } } } } }, _count: { select: { packingItems: true } } }, orderBy: { startsAt: 'desc' },
    }) };
  }

  async create(userId: string, householdId: string, dto: CreateTripDto) {
    const membership = await this.requireMember(userId, householdId, 'EDIT');
    const startsAt = new Date(dto.startsAt);
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : undefined;
    if (Number.isNaN(startsAt.valueOf()) || (endsAt && (Number.isNaN(endsAt.valueOf()) || endsAt < startsAt))) throw new BadRequestException('Invalid trip time range');
    const trip = await this.prisma.$transaction(async (tx) => {
      const created = await tx.trip.create({ data: { householdId, title: dto.title.trim(), startsAt, endsAt, destination: dto.destination?.trim(), members: { create: { membershipId: membership.id, canEdit: true } } }, include: { members: { include: { membership: { include: { user: { select: { id: true, nickname: true, avatarUrl: true } } } } } }, _count: { select: { packingItems: true } } } });
      await tx.calendarEvent.create({ data: { householdId, type: 'TRIP', title: created.title, startsAt, endsAt, sourceType: 'TRIP', sourceId: created.id, createdById: userId } });
      return created;
    });
    return { data: trip };
  }

  private async requireMember(userId: string, householdId: string, level: Level = 'VIEW') {
    return this.access.require(userId, householdId, 'trips', level);
  }
}
