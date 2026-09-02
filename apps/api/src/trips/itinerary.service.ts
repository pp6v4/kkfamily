import { AccessService } from '../access/access.service';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TripMemberStatus, TripRouteKind, TripStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { serializable } from '../prisma/serializable';
import { CreateAccommodationDto, CreateTripLegDto, CreateTripStopDto, ReorderTripStopsDto, UpdateAccommodationDto, UpdateTripLegDto, UpdateTripStopDto } from './dto/itinerary.dto';

const activeTripStatuses: TripStatus[] = [TripStatus.PLANNING, TripStatus.PENDING, TripStatus.DEPARTING];
const legInclude = { fromStop: true, toStop: true } as const;
const accommodationInclude = { stop: true } as const;

@Injectable()
export class ItineraryService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService) {}

  async list(userId: string, householdId: string, tripId: string) {
    const { trip } = await this.requireTrip(userId, householdId, tripId, false);
    const [stops, legs, accommodations] = await Promise.all([
      this.prisma.tripStop.findMany({ where: { tripId, archivedAt: null }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
      this.prisma.tripLeg.findMany({ where: { tripId, archivedAt: null }, include: legInclude, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      this.prisma.accommodation.findMany({ where: { tripId, archivedAt: null }, include: accommodationInclude, orderBy: [{ checkInDate: 'asc' }, { id: 'asc' }] }),
    ]);
    return { data: { tripVersion: trip.version, stops, legs, accommodations } };
  }

  async createStop(userId: string, householdId: string, tripId: string, dto: CreateTripStopDto) {
    return { data: await serializable(this.prisma, async tx => {
      const actor = await this.requireTripVersion(tx, userId, householdId, tripId, dto.expectedTripVersion);
      const times = this.stopTimes(dto.arriveAt, dto.leaveAt);
      const max = await tx.tripStop.aggregate({ where: { tripId, archivedAt: null }, _max: { sortOrder: true } });
      const stop = await tx.tripStop.create({ data: { tripId, title: dto.title.trim(), stopType: dto.stopType, latitude: dto.latitude, longitude: dto.longitude, arriveAt: times.arriveAt, leaveAt: times.leaveAt, sortOrder: dto.sortOrder ?? ((max._max.sortOrder ?? -1) + 1), note: dto.note?.trim() || null } });
      const tripVersion = await this.touchTrip(tx, tripId, dto.expectedTripVersion);
      await this.audit(tx, householdId, actor.id, 'TRIP_STOP_CREATE', stop.id, { tripId });
      return { tripVersion, stop };
    }) };
  }

  async updateStop(userId: string, householdId: string, tripId: string, stopId: string, dto: UpdateTripStopDto) {
    return { data: await serializable(this.prisma, async tx => {
      const actor = await this.requireTripVersion(tx, userId, householdId, tripId, dto.expectedTripVersion);
      const current = await tx.tripStop.findFirst({ where: { id: stopId, tripId, archivedAt: null } });
      if (!current) throw new NotFoundException('行程节点不存在');
      if (current.version !== dto.expectedVersion) throw new ConflictException('行程节点已更新，请刷新后重试');
      const times = this.stopTimes(dto.arriveAt === undefined ? current.arriveAt?.toISOString() : dto.arriveAt ?? undefined, dto.leaveAt === undefined ? current.leaveAt?.toISOString() : dto.leaveAt ?? undefined);
      const changed = await tx.tripStop.updateMany({ where: { id: stopId, tripId, archivedAt: null, version: dto.expectedVersion }, data: { title: dto.title?.trim(), stopType: dto.stopType, latitude: dto.latitude, longitude: dto.longitude, arriveAt: times.arriveAt, leaveAt: times.leaveAt, note: dto.note === undefined ? undefined : dto.note.trim() || null, version: { increment: 1 } } });
      if (!changed.count) throw new ConflictException('行程节点已更新，请刷新后重试');
      await tx.tripLeg.updateMany({ where: { tripId, archivedAt: null, OR: [{ fromStopId: stopId }, { toStopId: stopId }] }, data: { staleAt: new Date(), version: { increment: 1 } } });
      const tripVersion = await this.touchTrip(tx, tripId, dto.expectedTripVersion);
      await this.audit(tx, householdId, actor.id, 'TRIP_STOP_UPDATE', stopId, { tripId });
      return { tripVersion, stop: await tx.tripStop.findUniqueOrThrow({ where: { id: stopId } }) };
    }) };
  }

  async reorderStops(userId: string, householdId: string, tripId: string, dto: ReorderTripStopsDto) {
    return { data: await serializable(this.prisma, async tx => {
      const actor = await this.requireTripVersion(tx, userId, householdId, tripId, dto.expectedTripVersion);
      const active = await tx.tripStop.findMany({ where: { tripId, archivedAt: null }, select: { id: true } });
      if (active.length !== dto.stopIds.length || active.some(stop => !dto.stopIds.includes(stop.id))) throw new BadRequestException('节点顺序必须完整且不能包含其他行程节点');
      for (const [sortOrder, id] of dto.stopIds.entries()) await tx.tripStop.update({ where: { id }, data: { sortOrder, version: { increment: 1 } } });
      await tx.tripLeg.updateMany({ where: { tripId, archivedAt: null }, data: { staleAt: new Date(), version: { increment: 1 } } });
      const tripVersion = await this.touchTrip(tx, tripId, dto.expectedTripVersion);
      await this.audit(tx, householdId, actor.id, 'TRIP_STOPS_REORDER', tripId, { stopIds: dto.stopIds });
      return { tripVersion, stops: await tx.tripStop.findMany({ where: { tripId, archivedAt: null }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }) };
    }) };
  }

  async stopDeleteImpact(userId: string, householdId: string, tripId: string, stopId: string) {
    await this.requireTrip(userId, householdId, tripId, true);
    const stop = await this.prisma.tripStop.findFirst({ where: { id: stopId, tripId, archivedAt: null } });
    if (!stop) throw new NotFoundException('行程节点不存在');
    const [legs, accommodations] = await Promise.all([
      this.prisma.tripLeg.findMany({ where: { tripId, archivedAt: null, OR: [{ fromStopId: stopId }, { toStopId: stopId }] }, select: { id: true, fromStopId: true, toStopId: true, mode: true } }),
      this.prisma.accommodation.findMany({ where: { tripId, archivedAt: null, stopId }, select: { id: true, name: true } }),
    ]);
    return { data: { stopId, legs, accommodations } };
  }

  async removeStop(userId: string, householdId: string, tripId: string, stopId: string, expectedVersion: number, expectedTripVersion: number, confirm = false) {
    return { data: await serializable(this.prisma, async tx => {
      const actor = await this.requireTripVersion(tx, userId, householdId, tripId, expectedTripVersion);
      const stop = await tx.tripStop.findFirst({ where: { id: stopId, tripId, archivedAt: null } });
      if (!stop) throw new NotFoundException('行程节点不存在');
      if (stop.version !== expectedVersion) throw new ConflictException('行程节点已更新，请刷新后重试');
      const [legCount, accommodationCount] = await Promise.all([
        tx.tripLeg.count({ where: { tripId, archivedAt: null, OR: [{ fromStopId: stopId }, { toStopId: stopId }] } }),
        tx.accommodation.count({ where: { tripId, archivedAt: null, stopId } }),
      ]);
      if ((legCount || accommodationCount) && !confirm) throw new ConflictException(`该节点关联 ${legCount} 条路线和 ${accommodationCount} 条住宿，请确认后移除`);
      const archivedAt = new Date();
      const changed = await tx.tripStop.updateMany({ where: { id: stopId, tripId, archivedAt: null, version: expectedVersion }, data: { archivedAt, version: { increment: 1 } } });
      if (!changed.count) throw new ConflictException('行程节点已更新，请刷新后重试');
      await tx.tripLeg.updateMany({ where: { tripId, archivedAt: null, OR: [{ fromStopId: stopId }, { toStopId: stopId }] }, data: { archivedAt, version: { increment: 1 } } });
      await tx.accommodation.updateMany({ where: { tripId, archivedAt: null, stopId }, data: { stopId: null, version: { increment: 1 } } });
      const tripVersion = await this.touchTrip(tx, tripId, expectedTripVersion);
      await this.audit(tx, householdId, actor.id, 'TRIP_STOP_ARCHIVE', stopId, { tripId, legCount, accommodationCount });
      return { removed: true, tripVersion, affected: { legCount, accommodationCount } };
    }) };
  }

  async createLeg(userId: string, householdId: string, tripId: string, dto: CreateTripLegDto) {
    return { data: await serializable(this.prisma, async tx => {
      const actor = await this.requireTripVersion(tx, userId, householdId, tripId, dto.expectedTripVersion);
      await this.requireStops(tx, tripId, dto.fromStopId, dto.toStopId);
      const duplicate = await tx.tripLeg.findFirst({ where: { tripId, fromStopId: dto.fromStopId, toStopId: dto.toStopId, archivedAt: null } });
      if (duplicate) throw new ConflictException('这两个节点之间已经有一条路线');
      const route = this.routeData(dto.routeKind ?? TripRouteKind.SCHEMATIC, dto.geometry, dto.provider);
      const leg = await tx.tripLeg.create({ data: { tripId, fromStopId: dto.fromStopId, toStopId: dto.toStopId, mode: dto.mode, routeKind: route.routeKind, geometryJson: route.geometry, provider: route.provider, distanceMeters: dto.distanceMeters, durationSeconds: dto.durationSeconds } , include: legInclude });
      const tripVersion = await this.touchTrip(tx, tripId, dto.expectedTripVersion);
      await this.audit(tx, householdId, actor.id, 'TRIP_LEG_CREATE', leg.id, { tripId, routeKind: leg.routeKind });
      return { tripVersion, leg };
    }) };
  }

  async updateLeg(userId: string, householdId: string, tripId: string, legId: string, dto: UpdateTripLegDto) {
    return { data: await serializable(this.prisma, async tx => {
      const actor = await this.requireTripVersion(tx, userId, householdId, tripId, dto.expectedTripVersion);
      const current = await tx.tripLeg.findFirst({ where: { id: legId, tripId, archivedAt: null } });
      if (!current) throw new NotFoundException('行程路线不存在');
      if (current.version !== dto.expectedVersion) throw new ConflictException('行程路线已更新，请刷新后重试');
      const fromStopId = dto.fromStopId ?? current.fromStopId, toStopId = dto.toStopId ?? current.toStopId;
      await this.requireStops(tx, tripId, fromStopId, toStopId);
      const routeKind = dto.routeKind ?? current.routeKind;
      const endpointsChanged = fromStopId !== current.fromStopId || toStopId !== current.toStopId;
      if (routeKind === TripRouteKind.PLANNED && (current.staleAt || endpointsChanged) && dto.geometry === undefined) throw new ConflictException('路线已过期或端点已变化，需要重新规划后再保存');
      const geometry = dto.geometry ?? (current.geometryJson as number[][] | null) ?? undefined;
      const provider = routeKind === TripRouteKind.SCHEMATIC ? undefined : dto.provider === undefined ? current.provider ?? undefined : dto.provider || undefined;
      const route = this.routeData(routeKind, geometry, provider);
      const changed = await tx.tripLeg.updateMany({ where: { id: legId, tripId, archivedAt: null, version: dto.expectedVersion }, data: { fromStopId, toStopId, mode: dto.mode, routeKind: route.routeKind, geometryJson: route.geometry, provider: route.provider, distanceMeters: dto.distanceMeters, durationSeconds: dto.durationSeconds, staleAt: null, version: { increment: 1 } } });
      if (!changed.count) throw new ConflictException('行程路线已更新，请刷新后重试');
      const tripVersion = await this.touchTrip(tx, tripId, dto.expectedTripVersion);
      await this.audit(tx, householdId, actor.id, 'TRIP_LEG_UPDATE', legId, { tripId });
      return { tripVersion, leg: await tx.tripLeg.findUniqueOrThrow({ where: { id: legId }, include: legInclude }) };
    }) };
  }

  async removeLeg(userId: string, householdId: string, tripId: string, legId: string, expectedVersion: number, expectedTripVersion: number) {
    return { data: await serializable(this.prisma, async tx => {
      const actor = await this.requireTripVersion(tx, userId, householdId, tripId, expectedTripVersion);
      const current = await tx.tripLeg.findFirst({ where: { id: legId, tripId, archivedAt: null } });
      if (!current) throw new NotFoundException('行程路线不存在');
      const changed = await tx.tripLeg.updateMany({ where: { id: legId, tripId, archivedAt: null, version: expectedVersion }, data: { archivedAt: new Date(), version: { increment: 1 } } });
      if (!changed.count) throw new ConflictException('行程路线已更新，请刷新后重试');
      const tripVersion = await this.touchTrip(tx, tripId, expectedTripVersion);
      await this.audit(tx, householdId, actor.id, 'TRIP_LEG_ARCHIVE', legId, { tripId });
      return { removed: true, tripVersion };
    }) };
  }

  async createAccommodation(userId: string, householdId: string, tripId: string, dto: CreateAccommodationDto) {
    return { data: await serializable(this.prisma, async tx => {
      const actor = await this.requireTripVersion(tx, userId, householdId, tripId, dto.expectedTripVersion);
      if (dto.stopId) await this.requireStop(tx, tripId, dto.stopId);
      const dates = this.accommodationDates(dto.checkInDate, dto.checkOutDate);
      const accommodation = await tx.accommodation.create({ data: { tripId, stopId: dto.stopId, name: dto.name.trim(), address: dto.address?.trim() || null, checkInDate: dates.checkInDate, checkOutDate: dates.checkOutDate, contact: dto.contact?.trim() || null, reservationNote: dto.reservationNote?.trim() || null }, include: accommodationInclude });
      const tripVersion = await this.touchTrip(tx, tripId, dto.expectedTripVersion);
      await this.audit(tx, householdId, actor.id, 'TRIP_ACCOMMODATION_CREATE', accommodation.id, { tripId });
      return { tripVersion, accommodation };
    }) };
  }

  async updateAccommodation(userId: string, householdId: string, tripId: string, accommodationId: string, dto: UpdateAccommodationDto) {
    return { data: await serializable(this.prisma, async tx => {
      const actor = await this.requireTripVersion(tx, userId, householdId, tripId, dto.expectedTripVersion);
      const current = await tx.accommodation.findFirst({ where: { id: accommodationId, tripId, archivedAt: null } });
      if (!current) throw new NotFoundException('住宿记录不存在');
      if (current.version !== dto.expectedVersion) throw new ConflictException('住宿记录已更新，请刷新后重试');
      const stopId = dto.stopId === undefined ? current.stopId : dto.stopId?.trim() || null;
      if (stopId) await this.requireStop(tx, tripId, stopId);
      const dates = this.accommodationDates(dto.checkInDate ?? this.dateOnly(current.checkInDate), dto.checkOutDate ?? this.dateOnly(current.checkOutDate));
      const changed = await tx.accommodation.updateMany({ where: { id: accommodationId, tripId, archivedAt: null, version: dto.expectedVersion }, data: { stopId, name: dto.name?.trim(), address: dto.address === undefined ? undefined : dto.address.trim() || null, checkInDate: dates.checkInDate, checkOutDate: dates.checkOutDate, contact: dto.contact === undefined ? undefined : dto.contact.trim() || null, reservationNote: dto.reservationNote === undefined ? undefined : dto.reservationNote.trim() || null, version: { increment: 1 } } });
      if (!changed.count) throw new ConflictException('住宿记录已更新，请刷新后重试');
      const tripVersion = await this.touchTrip(tx, tripId, dto.expectedTripVersion);
      await this.audit(tx, householdId, actor.id, 'TRIP_ACCOMMODATION_UPDATE', accommodationId, { tripId });
      return { tripVersion, accommodation: await tx.accommodation.findUniqueOrThrow({ where: { id: accommodationId }, include: accommodationInclude }) };
    }) };
  }

  async removeAccommodation(userId: string, householdId: string, tripId: string, accommodationId: string, expectedVersion: number, expectedTripVersion: number) {
    return { data: await serializable(this.prisma, async tx => {
      const actor = await this.requireTripVersion(tx, userId, householdId, tripId, expectedTripVersion);
      const current = await tx.accommodation.findFirst({ where: { id: accommodationId, tripId, archivedAt: null } });
      if (!current) throw new NotFoundException('住宿记录不存在');
      const changed = await tx.accommodation.updateMany({ where: { id: accommodationId, tripId, archivedAt: null, version: expectedVersion }, data: { archivedAt: new Date(), version: { increment: 1 } } });
      if (!changed.count) throw new ConflictException('住宿记录已更新，请刷新后重试');
      const tripVersion = await this.touchTrip(tx, tripId, expectedTripVersion);
      await this.audit(tx, householdId, actor.id, 'TRIP_ACCOMMODATION_ARCHIVE', accommodationId, { tripId });
      return { removed: true, tripVersion };
    }) };
  }

  private async requireTrip(userId: string, householdId: string, tripId: string, edit: boolean, tx: Prisma.TransactionClient | PrismaService = this.prisma) {
    const membership = await this.access.require(userId, householdId, 'trips', edit ? 'EDIT' : 'VIEW', tx);
    const member = await tx.tripMember.findFirst({ where: { tripId, membershipId: membership.id, status: { in: [TripMemberStatus.ACTIVE, TripMemberStatus.HISTORY] }, trip: { householdId } }, include: { trip: true } });
    if (!member) throw new ForbiddenException('你不是该行程成员或访问已被撤销');
    if (edit && (member.status !== TripMemberStatus.ACTIVE || !member.canEdit)) throw new ForbiddenException('当前成员只能查看该行程');
    if (edit && !activeTripStatuses.includes(member.trip.status)) throw new ConflictException('已结束的行程只能查看');
    return { membership, tripMember: member, trip: member.trip };
  }

  private async requireTripVersion(tx: Prisma.TransactionClient, userId: string, householdId: string, tripId: string, expectedVersion: number) {
    const result = await this.requireTrip(userId, householdId, tripId, true, tx);
    if (result.trip.version !== expectedVersion) throw new ConflictException('行程已更新，请刷新后重试');
    return result.membership;
  }

  private async touchTrip(tx: Prisma.TransactionClient, tripId: string, expectedVersion: number) {
    const changed = await tx.trip.updateMany({ where: { id: tripId, version: expectedVersion }, data: { version: { increment: 1 } } });
    if (!changed.count) throw new ConflictException('行程已更新，请刷新后重试');
    return expectedVersion + 1;
  }

  private async requireStop(tx: Prisma.TransactionClient, tripId: string, stopId: string) {
    const stop = await tx.tripStop.findFirst({ where: { id: stopId, tripId, archivedAt: null } });
    if (!stop) throw new BadRequestException('所选节点不属于当前行程');
    return stop;
  }

  private async requireStops(tx: Prisma.TransactionClient, tripId: string, fromStopId: string, toStopId: string) {
    if (fromStopId === toStopId) throw new BadRequestException('路线起点和终点不能相同');
    await Promise.all([this.requireStop(tx, tripId, fromStopId), this.requireStop(tx, tripId, toStopId)]);
  }

  private stopTimes(arriveAtInput?: string, leaveAtInput?: string) {
    const arriveAt = arriveAtInput ? new Date(arriveAtInput) : null, leaveAt = leaveAtInput ? new Date(leaveAtInput) : null;
    if ((arriveAt && Number.isNaN(arriveAt.valueOf())) || (leaveAt && Number.isNaN(leaveAt.valueOf())) || (arriveAt && leaveAt && leaveAt < arriveAt)) throw new BadRequestException('节点到达和离开时间无效');
    return { arriveAt, leaveAt };
  }

  private routeData(routeKind: TripRouteKind, geometryInput?: number[][], providerInput?: string) {
    const geometry = geometryInput ? this.geometry(geometryInput) : undefined;
    const provider = providerInput?.trim() || undefined;
    if (routeKind === TripRouteKind.PLANNED && (!geometry || !provider)) throw new BadRequestException('导航路线必须包含供应商和真实路线几何');
    if (routeKind === TripRouteKind.SCHEMATIC && provider) throw new BadRequestException('示意路线不能标记为供应商规划结果');
    return { routeKind, geometry: geometry as Prisma.InputJsonValue | undefined, provider: provider ?? null };
  }

  private geometry(points: number[][]) {
    if (points.length < 2 || points.length > 5000) throw new BadRequestException('路线几何点数量必须在2到5000之间');
    return points.map(point => {
      if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite) || point[0] < -180 || point[0] > 180 || point[1] < -90 || point[1] > 90) throw new BadRequestException('路线坐标必须为有效的[lng,lat]');
      return [point[0], point[1]];
    });
  }

  private accommodationDates(checkIn: string, checkOut: string) {
    const checkInDate = new Date(`${checkIn}T00:00:00.000Z`), checkOutDate = new Date(`${checkOut}T00:00:00.000Z`);
    if (Number.isNaN(checkInDate.valueOf()) || Number.isNaN(checkOutDate.valueOf()) || checkOutDate <= checkInDate) throw new BadRequestException('退房日期必须晚于入住日期');
    return { checkInDate, checkOutDate };
  }

  private dateOnly(value: Date) { return value.toISOString().slice(0, 10); }

  private async audit(tx: Prisma.TransactionClient, householdId: string, actorMembershipId: string, action: string, targetId: string, details: Prisma.InputJsonValue) {
    await tx.auditLog.create({ data: { householdId, actorMembershipId, action, targetId, details } });
  }
}
