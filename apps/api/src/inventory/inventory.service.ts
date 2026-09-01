import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccessService } from '../access/access.service';
import { PrismaService } from '../prisma/prisma.service';
import { serializable } from '../prisma/serializable';
import { SetInventoryItemDto } from './dto/set-inventory-item.dto';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService) {}

  async list(userId: string, householdId: string) {
    await this.access.require(userId, householdId, 'inventory');
    return { data: await this.prisma.inventoryItem.findMany({ where: { householdId }, include: { ingredient: true }, orderBy: [{ ingredient: { name: 'asc' } }, { location: 'asc' }, { id: 'asc' }] }) };
  }

  async set(userId: string, householdId: string, dto: SetInventoryItemDto) {
    return serializable(this.prisma, async tx => {
      const member = await this.access.require(userId, householdId, 'inventory', 'EDIT', tx);
      const kind = dto.kind ?? 'FOOD', unit = kind === 'SEASONING' ? '' : dto.unit;
      if (kind === 'FOOD' && !unit) throw new BadRequestException('食材库存需要填写单位；数量可以待确认');
      if (kind === 'SEASONING' && (dto.quantity !== undefined || dto.unit)) throw new BadRequestException('调料只登记有无，不填写数量和单位');
      let quantity = kind === 'SEASONING' || dto.quantity === undefined ? null : new Prisma.Decimal(dto.quantity);
      if (dto.availability === 'ABSENT' && quantity?.gt(0)) throw new BadRequestException('标记无库存时数量不能大于0');
      if (dto.availability === 'UNKNOWN' && quantity !== null) throw new BadRequestException('待确认库存请留空数量');
      if (kind === 'FOOD' && dto.availability === 'ABSENT') quantity = new Prisma.Decimal(0);
      const availability = quantity === null ? dto.availability ?? 'UNKNOWN' : quantity.isZero() ? 'ABSENT' : 'PRESENT';
      const expiresAt = dto.expiresAt ? new Date(dto.expiresAt.length === 10 ? `${dto.expiresAt}T23:59:59+08:00` : dto.expiresAt) : null;
      if (expiresAt && Number.isNaN(expiresAt.valueOf())) throw new BadRequestException('到期时间格式无效');
      const ingredient = await tx.ingredient.upsert({ where: { householdId_name_kind: { householdId, name: dto.name, kind } }, update: {}, create: { householdId, name: dto.name, kind, defaultUnit: unit ?? '' } });
      const location = dto.location ?? null;
      const current = dto.id ? await tx.inventoryItem.findFirst({ where: { id: dto.id, householdId } })
        : await tx.inventoryItem.findFirst({ where: { householdId, ingredientId: ingredient.id, unit: unit!, location } });
      if (dto.id && !current) throw new NotFoundException('库存记录不存在');
      if (current && (current.ingredientId !== ingredient.id || current.unit !== unit || current.location !== location)) throw new BadRequestException('调整库存不能改变食材、单位和存放位置，请另建一条记录');
      if (current && current.version !== dto.expectedVersion) throw new ConflictException('调整已有库存需提交当前版本，请刷新后再保存');
      if (!current && dto.expectedVersion !== undefined) throw new ConflictException('库存记录已变化');
      const after = await tx.inventoryItem.upsert({ where: { id: current?.id ?? '__new_inventory__' }, create: { householdId, ingredientId: ingredient.id, quantity, availability, unit: unit!, location, expiresAt },
        update: { quantity, availability, expiresAt, version: { increment: 1 } }, include: { ingredient: true } });
      // A transition from/to unknown has no known arithmetic delta; retain null, not an invented zero.
      const beforeQuantity = current?.quantity ?? (current ? null : new Prisma.Decimal(0));
      const delta = beforeQuantity !== null && quantity !== null ? quantity.minus(beforeQuantity) : null;
      await tx.inventoryTransaction.create({ data: { inventoryItemId: after.id, type: 'ADJUST', quantityDelta: delta,
        beforeQuantity, afterQuantity: quantity, beforeAvailability: current?.availability ?? 'UNKNOWN', afterAvailability: availability,
        actorMembershipId: member.id, reason: current ? '用户核实并调整库存' : '用户登记库存' } });
      return { data: after };
    });
  }
}
