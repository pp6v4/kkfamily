import { AccessService } from '../access/access.service';
import { Level } from '../access/permission-policy';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PackingItemStatus, Prisma, TripMemberRole, TripMemberStatus, TripStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { serializable } from '../prisma/serializable';
import { CreateTripDto } from './dto/create-trip.dto';
import { AddTripMemberDto, CreatePreparationGroupDto, UpdatePreparationGroupDto, UpdateTripDto, UpdateTripMemberDto, UpdateTripStatusDto } from './dto/trip-actions.dto';

const visibleMemberStatuses: TripMemberStatus[] = [TripMemberStatus.ACTIVE, TripMemberStatus.HISTORY];
const userSelect = { id: true, nickname: true, avatarUrl: true } as const;
const tripInclude = {
  members: { where: { status: { in: visibleMemberStatuses } }, include: { membership: { include: { user: { select: userSelect } } } }, orderBy: [{ tripRole: 'asc' }, { joinedAt: 'asc' }] },
  preparationGroups: { include: { members: true }, orderBy: { createdAt: 'asc' } },
  stops: { where: { archivedAt: null }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
  legs: { where: { archivedAt: null }, include: { fromStop: true, toStop: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  _count: { select: { packingItems: { where: { excludedAt: null } } } },
} satisfies Prisma.TripInclude;

@Injectable()
export class TripsService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService) {}

  async list(userId: string, householdId: string) {
    const membership = await this.requireMember(userId, householdId);
    return { data: await this.prisma.trip.findMany({
      where: { householdId, members: { some: { membershipId: membership.id, status: { in: visibleMemberStatuses } } } },
      include: tripInclude, orderBy: { startsAt: 'desc' },
    }) };
  }

  async detail(userId: string, householdId: string, tripId: string) {
    await this.requireTripAccess(userId, householdId, tripId, false);
    return { data: await this.tripOrThrow(this.prisma, householdId, tripId) };
  }

  async create(userId: string, householdId: string, dto: CreateTripDto) {
    const membership = await this.requireMember(userId, householdId, 'EDIT');
    const { startsAt, endsAt } = this.parseDates(dto.startsAt, dto.endsAt);
    const trip = await this.prisma.$transaction(async tx => {
      const created = await tx.trip.create({
        data: {
          householdId, title: dto.title.trim(), startsAt, endsAt, destination: dto.destination?.trim(),
          members: { create: { membershipId: membership.id, canEdit: true, tripRole: TripMemberRole.OWNER, status: TripMemberStatus.ACTIVE } },
        }, include: tripInclude,
      });
      await tx.calendarEvent.create({ data: { householdId, type: 'TRIP', title: created.title, startsAt, endsAt, sourceType: 'TRIP', sourceId: created.id, createdById: userId } });
      return created;
    });
    return { data: trip };
  }

  async update(userId: string, householdId: string, tripId: string, dto: UpdateTripDto) {
    return { data: await serializable(this.prisma, async tx => {
      const { trip } = await this.requireTripAccess(userId, householdId, tripId, true, tx);
      if (trip.version !== dto.expectedVersion) throw new ConflictException('行程已更新，请刷新后重试');
      const startsAt = dto.startsAt ? new Date(dto.startsAt) : trip.startsAt;
      const endsAt = dto.endsAt === undefined ? trip.endsAt : dto.endsAt ? new Date(dto.endsAt) : null;
      this.assertDates(startsAt, endsAt ?? undefined);
      const updated = await tx.trip.update({ where: { id: tripId }, data: { title: dto.title?.trim(), startsAt, endsAt, destination: dto.destination === undefined ? undefined : dto.destination.trim() || null, version: { increment: 1 } } });
      await tx.calendarEvent.updateMany({ where: { householdId, sourceType: 'TRIP', sourceId: tripId }, data: { title: updated.title, startsAt: updated.startsAt, endsAt: updated.endsAt } });
      return this.tripOrThrow(tx, householdId, tripId);
    }) };
  }

  async updateStatus(userId: string, householdId: string, tripId: string, dto: UpdateTripStatusDto) {
    return { data: await serializable(this.prisma, async tx => {
      const { trip, tripMember } = await this.requireTripOwner(userId, householdId, tripId, tx);
      if (trip.version !== dto.expectedVersion) throw new ConflictException('行程已更新，请刷新后重试');
      if (trip.status === TripStatus.COMPLETED || trip.status === TripStatus.CANCELLED) throw new ConflictException('已结束的行程不能再次变更状态');
      const allowed: Record<TripStatus, TripStatus[]> = {
        PLANNING: [TripStatus.PENDING, TripStatus.CANCELLED],
        PENDING: [TripStatus.PLANNING, TripStatus.DEPARTING, TripStatus.CANCELLED],
        DEPARTING: [TripStatus.COMPLETED, TripStatus.CANCELLED],
        COMPLETED: [], CANCELLED: [],
      };
      if (!allowed[trip.status].includes(dto.status)) throw new BadRequestException('不允许的行程状态变更');
      await tx.trip.update({ where: { id: tripId }, data: { status: dto.status, completedAt: dto.status === TripStatus.COMPLETED ? new Date() : null, version: { increment: 1 } } });
      if (dto.status === TripStatus.COMPLETED) await tx.tripMember.updateMany({ where: { tripId, status: TripMemberStatus.ACTIVE }, data: { status: TripMemberStatus.HISTORY, leftAt: new Date(), version: { increment: 1 } } });
      if (dto.status === TripStatus.CANCELLED) await tx.calendarEvent.deleteMany({ where: { householdId, sourceType: 'TRIP', sourceId: tripId } });
      await this.audit(tx, householdId, tripMember.membershipId, 'TRIP_STATUS_UPDATE', tripId, { from: trip.status, to: dto.status });
      return this.tripOrThrow(tx, householdId, tripId);
    }) };
  }

  async candidates(userId: string, householdId: string, tripId: string) {
    await this.requireTripOwner(userId, householdId, tripId);
    const current = await this.prisma.tripMember.findMany({ where: { tripId, status: { in: visibleMemberStatuses } }, select: { membershipId: true } });
    return { data: await this.prisma.membership.findMany({ where: { householdId, status: 'ACTIVE', id: { notIn: current.map(item => item.membershipId) } }, select: { id: true, user: { select: userSelect } }, orderBy: { createdAt: 'asc' } }) };
  }

  async addMember(userId: string, householdId: string, tripId: string, dto: AddTripMemberDto) {
    return { data: await serializable(this.prisma, async tx => {
      const { tripMember: actor } = await this.requireTripOwner(userId, householdId, tripId, tx);
      const target = await tx.membership.findFirst({ where: { id: dto.membershipId, householdId, status: 'ACTIVE' } });
      if (!target) throw new NotFoundException('可加入的家庭成员不存在');
      const existing = await tx.tripMember.findUnique({ where: { tripId_membershipId: { tripId, membershipId: target.id } } });
      if (existing && existing.status !== TripMemberStatus.REVOKED) throw new ConflictException('该成员已经在行程中');
      if (existing) await tx.tripMember.update({ where: { tripId_membershipId: { tripId, membershipId: target.id } }, data: { status: TripMemberStatus.ACTIVE, tripRole: TripMemberRole.MEMBER, canEdit: dto.canEdit ?? true, leftAt: null, joinedAt: new Date(), version: { increment: 1 } } });
      else await tx.tripMember.create({ data: { tripId, membershipId: target.id, status: TripMemberStatus.ACTIVE, tripRole: TripMemberRole.MEMBER, canEdit: dto.canEdit ?? true } });
      await this.audit(tx, householdId, actor.membershipId, 'TRIP_MEMBER_ADD', tripId, { membershipId: target.id });
      return this.tripOrThrow(tx, householdId, tripId);
    }) };
  }

  async updateMember(userId: string, householdId: string, tripId: string, membershipId: string, dto: UpdateTripMemberDto) {
    return { data: await serializable(this.prisma, async tx => {
      const { tripMember: actor } = await this.requireTripOwner(userId, householdId, tripId, tx);
      const target = await tx.tripMember.findUnique({ where: { tripId_membershipId: { tripId, membershipId } } });
      if (!target || target.status === TripMemberStatus.REVOKED) throw new NotFoundException('行程成员不存在');
      if (target.version !== dto.expectedVersion) throw new ConflictException('成员信息已更新，请刷新后重试');
      if (dto.status && dto.status !== TripMemberStatus.ACTIVE && dto.status !== TripMemberStatus.REVOKED) throw new BadRequestException('历史状态只能由完成行程产生');
      const nextRole = dto.tripRole ?? target.tripRole, nextStatus = dto.status ?? target.status;
      if (nextRole === TripMemberRole.OWNER && dto.canEdit === false) throw new ConflictException('行程负责人必须保留编辑权限');
      if (target.tripRole === TripMemberRole.OWNER && (nextRole !== TripMemberRole.OWNER || nextStatus === TripMemberStatus.REVOKED)) {
        const owners = await tx.tripMember.count({ where: { tripId, tripRole: TripMemberRole.OWNER, status: TripMemberStatus.ACTIVE, canEdit: true, membershipId: { not: membershipId } } });
        if (owners === 0) throw new ConflictException('行程必须至少保留一名负责人');
      }
      if (nextStatus === TripMemberStatus.REVOKED) {
        const unresolved = await tx.tripPackingItem.count({ where: { tripId, responsibleMembershipId: membershipId, excludedAt: null, status: PackingItemStatus.PENDING } });
        if (unresolved && !dto.clearResponsibilities) throw new ConflictException(`该成员仍负责 ${unresolved} 项未准备物品，请先清空或重新分配`);
        if (dto.clearResponsibilities) await tx.tripPackingItem.updateMany({ where: { tripId, responsibleMembershipId: membershipId, excludedAt: null }, data: { responsibleMembershipId: null, version: { increment: 1 } } });
        await tx.tripPreparationGroupMember.deleteMany({ where: { tripId, membershipId } });
      }
      await tx.tripMember.update({ where: { tripId_membershipId: { tripId, membershipId } }, data: { canEdit: nextRole === TripMemberRole.OWNER ? true : dto.canEdit ?? target.canEdit, tripRole: nextRole, status: nextStatus, leftAt: nextStatus === TripMemberStatus.REVOKED ? new Date() : null, version: { increment: 1 } } });
      await this.audit(tx, householdId, actor.membershipId, 'TRIP_MEMBER_UPDATE', tripId, { membershipId, status: nextStatus, role: nextRole });
      return this.tripOrThrow(tx, householdId, tripId);
    }) };
  }

  async createGroup(userId: string, householdId: string, tripId: string, dto: CreatePreparationGroupDto) {
    return { data: await serializable(this.prisma, async tx => {
      await this.requireTripOwner(userId, householdId, tripId, tx);
      await this.assertGroupMembers(tx, tripId, dto.membershipIds);
      try { return await tx.tripPreparationGroup.create({ data: { tripId, name: dto.name.trim(), members: { create: dto.membershipIds.map(membershipId => ({ tripId, membershipId })) } }, include: { members: true } }); }
      catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('行程内已存在同名准备小组'); throw error; }
    }) };
  }

  async updateGroup(userId: string, householdId: string, tripId: string, groupId: string, dto: UpdatePreparationGroupDto) {
    return { data: await serializable(this.prisma, async tx => {
      await this.requireTripOwner(userId, householdId, tripId, tx);
      const group = await tx.tripPreparationGroup.findFirst({ where: { id: groupId, tripId }, include: { members: true } });
      if (!group) throw new NotFoundException('准备小组不存在');
      if (group.version !== dto.expectedVersion) throw new ConflictException('准备小组已更新，请刷新后重试');
      await this.assertGroupMembers(tx, tripId, dto.membershipIds);
      const removedIds = group.members.map(member => member.membershipId).filter(membershipId => !dto.membershipIds.includes(membershipId));
      if (removedIds.length && await tx.tripPackingItem.count({ where: { tripId, groupId, excludedAt: null, responsibleMembershipId: { in: removedIds } } })) throw new ConflictException('被移出小组的成员仍有行李责任，请先重新分配或清空');
      try { await tx.tripPreparationGroup.update({ where: { id: groupId }, data: { name: dto.name.trim(), version: { increment: 1 } } }); }
      catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('行程内已存在同名准备小组'); throw error; }
      await tx.tripPreparationGroupMember.deleteMany({ where: { groupId } });
      if (dto.membershipIds.length) await tx.tripPreparationGroupMember.createMany({ data: dto.membershipIds.map(membershipId => ({ groupId, tripId, membershipId })) });
      return tx.tripPreparationGroup.findUniqueOrThrow({ where: { id: groupId }, include: { members: true } });
    }) };
  }

  private async assertGroupMembers(tx: Prisma.TransactionClient, tripId: string, membershipIds: string[]) {
    const count = await tx.tripMember.count({ where: { tripId, membershipId: { in: membershipIds }, status: TripMemberStatus.ACTIVE } });
    if (count !== membershipIds.length) throw new BadRequestException('准备小组只能包含当前行程的有效成员');
  }

  private async tripOrThrow(tx: Prisma.TransactionClient | PrismaService, householdId: string, tripId: string) {
    const trip = await tx.trip.findFirst({ where: { id: tripId, householdId }, include: tripInclude });
    if (!trip) throw new NotFoundException('行程不存在');
    return trip;
  }

  private async requireTripOwner(userId: string, householdId: string, tripId: string, tx: Prisma.TransactionClient | PrismaService = this.prisma) {
    const result = await this.requireTripAccess(userId, householdId, tripId, true, tx);
    if (result.tripMember.tripRole !== TripMemberRole.OWNER) throw new ForbiddenException('只有行程负责人可以管理成员和小组');
    return result;
  }

  private async requireTripAccess(userId: string, householdId: string, tripId: string, edit: boolean, tx: Prisma.TransactionClient | PrismaService = this.prisma) {
    const membership = await this.access.require(userId, householdId, 'trips', edit ? 'EDIT' : 'VIEW', tx);
    const tripMember = await tx.tripMember.findFirst({ where: { tripId, membershipId: membership.id, status: { in: visibleMemberStatuses }, trip: { householdId } }, include: { trip: true } });
    if (!tripMember) throw new ForbiddenException('你不是该行程成员或访问已被撤销');
    if (edit && (tripMember.status !== TripMemberStatus.ACTIVE || !tripMember.canEdit)) throw new ForbiddenException('当前成员只能查看该行程');
    if (edit && (tripMember.trip.status === TripStatus.COMPLETED || tripMember.trip.status === TripStatus.CANCELLED)) throw new ConflictException('已结束的行程只能查看');
    return { membership, tripMember, trip: tripMember.trip };
  }

  private parseDates(startsAtInput: string, endsAtInput?: string) {
    const startsAt = new Date(startsAtInput), endsAt = endsAtInput ? new Date(endsAtInput) : undefined;
    this.assertDates(startsAt, endsAt); return { startsAt, endsAt };
  }

  private assertDates(startsAt: Date, endsAt?: Date) {
    if (Number.isNaN(startsAt.valueOf()) || (endsAt && (Number.isNaN(endsAt.valueOf()) || endsAt < startsAt))) throw new BadRequestException('行程时间范围无效');
  }

  private async audit(tx: Prisma.TransactionClient, householdId: string, actorMembershipId: string, action: string, targetId: string, details: Prisma.InputJsonValue) {
    await tx.auditLog.create({ data: { householdId, actorMembershipId, action, targetId, details } });
  }

  private async requireMember(userId: string, householdId: string, level: Level = 'VIEW') { return this.access.require(userId, householdId, 'trips', level); }
}
