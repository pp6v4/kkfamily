import { AccessService } from '../access/access.service';
import { Level, permits } from '../access/permission-policy';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PackingItemStatus, Prisma, TripMemberStatus, TripStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApplyPackingTemplateDto } from './dto/apply-packing-template.dto';
import { CreatePackingTemplateDto } from './dto/create-packing-template.dto';
import { CreateTripPackingItemDto } from './dto/create-trip-packing-item.dto';
import { UpdatePackingTemplateDto } from './dto/update-packing-template.dto';
import { UpdateTripPackingItemDto } from './dto/update-trip-packing-item.dto';

@Injectable()
export class PackingService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService) {}

  async listTemplates(userId: string, householdId: string) {
    await this.requireMember(userId, householdId);
    return { data: await this.prisma.packingTemplate.findMany({
      where: { householdId, archived: false }, include: { items: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } }, orderBy: { updatedAt: 'desc' },
    }) };
  }

  async createTemplate(userId: string, householdId: string, dto: CreatePackingTemplateDto) {
    const membership = await this.requireMember(userId, householdId, 'EDIT');
    await this.ensureTemplateNameAvailable(householdId, dto.name);
    return { data: await this.prisma.packingTemplate.create({
      data: {
        householdId, createdById: membership.id, name: dto.name.trim(), description: dto.description?.trim(),
        items: { create: dto.items.map((item, index) => ({ name: item.name.trim(), defaultQuantity: item.quantity, unit: item.unit?.trim(), note: item.note?.trim(), sortOrder: item.sortOrder ?? index })) },
      },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    }) };
  }

  async updateTemplate(userId: string, householdId: string, templateId: string, dto: UpdatePackingTemplateDto) {
    const membership = await this.requireMember(userId, householdId, 'EDIT');
    const template = await this.prisma.packingTemplate.findFirst({ where: { id: templateId, householdId } });
    if (!template) throw new NotFoundException('Packing template was not found');
    const isAdmin = permits(membership.effectivePermissions, 'packing_templates', 'MANAGE');
    if (template.createdById !== membership.id && !isAdmin) throw new ForbiddenException('Only the template creator or an administrator can edit it');
    if (dto.name && dto.name.trim() !== template.name) await this.ensureTemplateNameAvailable(householdId, dto.name);
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.packingTemplate.update({ where: { id: templateId }, data: { name: dto.name?.trim(), description: dto.description?.trim(), archived: dto.archived } });
      if (dto.items) {
        const existingItems = await tx.packingTemplateItem.findMany({ where: { templateId }, select: { id: true } });
        const existingIds = new Set(existingItems.map((item) => item.id));
        const retainedIds: string[] = [];
        for (const [index, item] of dto.items.entries()) {
          const data = { name: item.name.trim(), defaultQuantity: item.quantity, unit: item.unit?.trim(), note: item.note?.trim(), sortOrder: item.sortOrder ?? index };
          if (item.id) {
            if (!existingIds.has(item.id)) throw new BadRequestException('Packing template item does not belong to this template');
            await tx.packingTemplateItem.update({ where: { id: item.id }, data });
            retainedIds.push(item.id);
          } else {
            const created = await tx.packingTemplateItem.create({ data: { templateId, ...data } });
            retainedIds.push(created.id);
          }
        }
        await tx.packingTemplateItem.deleteMany({ where: { templateId, id: { notIn: retainedIds } } });
      }
      return tx.packingTemplate.findUniqueOrThrow({ where: { id: templateId }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
    });
    return { data: updated };
  }

  async listTripItems(userId: string, householdId: string, tripId: string) {
    await this.requireTripAccess(userId, householdId, tripId, false);
    return { data: await this.getTripItems(tripId) };
  }

  async applyTemplate(userId: string, householdId: string, tripId: string, dto: ApplyPackingTemplateDto) {
    await this.requireTripAccess(userId, householdId, tripId, true);
    await this.requireMember(userId, householdId);
    const template = await this.prisma.packingTemplate.findFirst({ where: { id: dto.templateId, householdId, archived: false }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
    if (!template) throw new NotFoundException('Packing template was not found');
    const result = await this.prisma.tripPackingItem.createMany({
      data: template.items.map((item) => ({
        tripId,
        sourceTemplateId: template.id,
        sourceTemplateItemId: item.id,
        sourceTemplateNameSnapshot: template.name,
        sourceItemNameSnapshot: item.name,
        name: item.name,
        quantity: item.defaultQuantity,
        unit: item.unit,
        note: item.note,
      })),
      skipDuplicates: true,
    });
    const addedCount = result.count;
    return { data: { templateId: template.id, addedCount, skippedCount: template.items.length - addedCount, items: await this.getTripItems(tripId) } };
  }

  async createTripItem(userId: string, householdId: string, tripId: string, dto: CreateTripPackingItemDto) {
    await this.requireTripAccess(userId, householdId, tripId, true);
    const responsibleMembershipId = dto.responsibleMembershipId?.trim();
    const groupId = dto.groupId?.trim();
    await this.requireValidAssignment(tripId, responsibleMembershipId, groupId);
    return { data: await this.prisma.tripPackingItem.create({
      data: { tripId, name: dto.name.trim(), quantity: dto.quantity, unit: dto.unit?.trim(), note: dto.note?.trim(), responsibleMembershipId, groupId },
      include: this.tripItemInclude(),
    }) };
  }

  async updateTripItem(userId: string, householdId: string, tripId: string, itemId: string, dto: UpdateTripPackingItemDto) {
    await this.requireTripAccess(userId, householdId, tripId, true);
    const item = await this.prisma.tripPackingItem.findFirst({ where: { id: itemId, tripId, excludedAt: null } });
    if (!item) throw new NotFoundException('Packing item was not found');
    if (item.version !== dto.expectedVersion) throw new ConflictException('行李项已更新，请刷新后重试');
    const responsibleMembershipId = dto.responsibleMembershipId === undefined ? undefined : dto.responsibleMembershipId.trim() || null;
    const groupId = dto.groupId === undefined ? undefined : dto.groupId.trim() || null;
    await this.requireValidAssignment(tripId, responsibleMembershipId === undefined ? item.responsibleMembershipId : responsibleMembershipId, groupId === undefined ? item.groupId : groupId);
    const data: Prisma.TripPackingItemUncheckedUpdateInput = {
      name: dto.name?.trim(), quantity: dto.quantity, unit: dto.unit?.trim(), note: dto.note?.trim(), status: dto.status, responsibleMembershipId, groupId, version: { increment: 1 },
    };
    const updated = await this.prisma.tripPackingItem.updateMany({ where: { id: itemId, tripId, excludedAt: null, version: dto.expectedVersion }, data });
    if (!updated.count) throw new ConflictException('行李项已更新，请刷新后重试');
    return { data: await this.prisma.tripPackingItem.findUniqueOrThrow({ where: { id: itemId }, include: this.tripItemInclude() }) };
  }

  async removeTripItem(userId: string, householdId: string, tripId: string, itemId: string, expectedVersion: number) {
    await this.requireTripAccess(userId, householdId, tripId, true);
    const exists = await this.prisma.tripPackingItem.findFirst({ where: { id: itemId, tripId, excludedAt: null } });
    if (!exists) throw new NotFoundException('Packing item was not found');
    const result = await this.prisma.tripPackingItem.updateMany({ where: { id: itemId, tripId, excludedAt: null, version: expectedVersion }, data: { excludedAt: new Date(), version: { increment: 1 } } });
    if (result.count === 0) throw new ConflictException('行李项已更新，请刷新后重试');
    return { data: { removed: true } };
  }

  private async getTripItems(tripId: string) {
    return this.prisma.tripPackingItem.findMany({ where: { tripId, excludedAt: null }, include: this.tripItemInclude(), orderBy: [{ status: 'asc' }, { createdAt: 'asc' }] });
  }

  private tripItemInclude() {
    return { sourceTemplate: { select: { id: true, name: true } }, group: { select: { id: true, name: true } }, responsibleMembership: { include: { user: { select: { id: true, nickname: true, avatarUrl: true } } } } } as const;
  }

  private async ensureTemplateNameAvailable(householdId: string, name: string) {
    const duplicate = await this.prisma.packingTemplate.findFirst({ where: { householdId, name: name.trim() } });
    if (duplicate) throw new ConflictException('A packing template with this name already exists');
  }

  private async requireMember(userId: string, householdId: string, level: Level = 'VIEW') {
    return this.access.require(userId, householdId, 'packing_templates', level);
  }

  private async requireTripAccess(userId: string, householdId: string, tripId: string, edit: boolean) {
    const membership = await this.access.require(userId, householdId, 'trips', edit ? 'EDIT' : 'VIEW');
    const tripMember = await this.prisma.tripMember.findFirst({ where: { tripId, membershipId: membership.id, status: { in: [TripMemberStatus.ACTIVE, TripMemberStatus.HISTORY] }, trip: { householdId } }, include: { trip: true } });
    if (!tripMember) throw new ForbiddenException('No access to this trip');
    if (edit && (tripMember.status !== TripMemberStatus.ACTIVE || !tripMember.canEdit)) throw new ForbiddenException('This trip is read-only for the current member');
    if (edit && (tripMember.trip.status === TripStatus.COMPLETED || tripMember.trip.status === TripStatus.CANCELLED)) throw new ConflictException('已结束的行程只能查看');
    return { membership, tripMember };
  }

  private async requireValidAssignment(tripId: string, membershipId?: string | null, groupId?: string | null) {
    if (groupId) {
      const group = await this.prisma.tripPreparationGroup.findFirst({ where: { id: groupId, tripId } });
      if (!group) throw new BadRequestException('准备小组不属于当前行程');
    }
    if (!membershipId) return;
    const member = await this.prisma.tripMember.findUnique({ where: { tripId_membershipId: { tripId, membershipId } } });
    if (!member || member.status !== TripMemberStatus.ACTIVE || !(await this.prisma.membership.findFirst({ where: { id: membershipId, status: 'ACTIVE' } }))) throw new BadRequestException('The responsible member must be active and belong to this trip');
    if (groupId && !(await this.prisma.tripPreparationGroupMember.findUnique({ where: { groupId_membershipId: { groupId, membershipId } } }))) throw new BadRequestException('物品负责人必须属于所选准备小组');
  }
}
