import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PackingItemStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApplyPackingTemplateDto } from './dto/apply-packing-template.dto';
import { CreatePackingTemplateDto } from './dto/create-packing-template.dto';
import { CreateTripPackingItemDto } from './dto/create-trip-packing-item.dto';
import { UpdatePackingTemplateDto } from './dto/update-packing-template.dto';
import { UpdateTripPackingItemDto } from './dto/update-trip-packing-item.dto';

@Injectable()
export class PackingService {
  constructor(private readonly prisma: PrismaService) {}

  async listTemplates(userId: string, householdId: string) {
    await this.requireMember(userId, householdId);
    return { data: await this.prisma.packingTemplate.findMany({
      where: { householdId, archived: false }, include: { items: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } }, orderBy: { updatedAt: 'desc' },
    }) };
  }

  async createTemplate(userId: string, householdId: string, dto: CreatePackingTemplateDto) {
    const membership = await this.requireMember(userId, householdId);
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
    const membership = await this.requireMember(userId, householdId);
    const template = await this.prisma.packingTemplate.findFirst({ where: { id: templateId, householdId } });
    if (!template) throw new NotFoundException('Packing template was not found');
    const isAdmin = membership.roles.some((entry) => entry.role.code === 'ADMIN');
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
    const template = await this.prisma.packingTemplate.findFirst({ where: { id: dto.templateId, householdId, archived: false }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
    if (!template) throw new NotFoundException('Packing template was not found');
    const result = await this.prisma.tripPackingItem.createMany({
      data: template.items.map((item) => ({
        tripId,
        sourceTemplateId: template.id,
        sourceTemplateItemId: item.id,
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
    if (responsibleMembershipId) await this.requireResponsibleTripMember(tripId, responsibleMembershipId);
    return { data: await this.prisma.tripPackingItem.create({
      data: { tripId, name: dto.name.trim(), quantity: dto.quantity, unit: dto.unit?.trim(), note: dto.note?.trim(), responsibleMembershipId },
      include: this.tripItemInclude(),
    }) };
  }

  async updateTripItem(userId: string, householdId: string, tripId: string, itemId: string, dto: UpdateTripPackingItemDto) {
    await this.requireTripAccess(userId, householdId, tripId, true);
    const item = await this.prisma.tripPackingItem.findFirst({ where: { id: itemId, tripId } });
    if (!item) throw new NotFoundException('Packing item was not found');
    const responsibleMembershipId = dto.responsibleMembershipId === undefined ? undefined : dto.responsibleMembershipId.trim() || null;
    if (responsibleMembershipId) await this.requireResponsibleTripMember(tripId, responsibleMembershipId);
    const data: Prisma.TripPackingItemUncheckedUpdateInput = {
      name: dto.name?.trim(), quantity: dto.quantity, unit: dto.unit?.trim(), note: dto.note?.trim(), status: dto.status, responsibleMembershipId,
    };
    return { data: await this.prisma.tripPackingItem.update({ where: { id: itemId }, data, include: this.tripItemInclude() }) };
  }

  async removeTripItem(userId: string, householdId: string, tripId: string, itemId: string) {
    await this.requireTripAccess(userId, householdId, tripId, true);
    const result = await this.prisma.tripPackingItem.deleteMany({ where: { id: itemId, tripId } });
    if (result.count === 0) throw new NotFoundException('Packing item was not found');
    return { data: { removed: true } };
  }

  private async getTripItems(tripId: string) {
    return this.prisma.tripPackingItem.findMany({ where: { tripId }, include: this.tripItemInclude(), orderBy: [{ status: 'asc' }, { createdAt: 'asc' }] });
  }

  private tripItemInclude() {
    return { sourceTemplate: { select: { id: true, name: true } }, responsibleMembership: { include: { user: { select: { id: true, nickname: true, avatarUrl: true } } } } } as const;
  }

  private async ensureTemplateNameAvailable(householdId: string, name: string) {
    const duplicate = await this.prisma.packingTemplate.findFirst({ where: { householdId, name: name.trim() } });
    if (duplicate) throw new ConflictException('A packing template with this name already exists');
  }

  private async requireMember(userId: string, householdId: string) {
    const membership = await this.prisma.membership.findFirst({ where: { householdId, userId, status: 'ACTIVE' }, include: { roles: { include: { role: true } } } });
    if (!membership) throw new ForbiddenException('No access to this household');
    return membership;
  }

  private async requireTripAccess(userId: string, householdId: string, tripId: string, edit: boolean) {
    const membership = await this.requireMember(userId, householdId);
    const tripMember = await this.prisma.tripMember.findFirst({ where: { tripId, membershipId: membership.id, trip: { householdId } } });
    if (!tripMember) throw new ForbiddenException('No access to this trip');
    if (edit && !tripMember.canEdit) throw new ForbiddenException('This trip is read-only for the current member');
    return { membership, tripMember };
  }

  private async requireResponsibleTripMember(tripId: string, membershipId: string) {
    const member = await this.prisma.tripMember.findUnique({ where: { tripId_membershipId: { tripId, membershipId } } });
    if (!member) throw new BadRequestException('The responsible member must belong to this trip');
  }
}
