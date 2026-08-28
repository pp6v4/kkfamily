import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SetInventoryItemDto } from './dto/set-inventory-item.dto';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, householdId: string) {
    await this.requireMember(userId, householdId);
    return { data: await this.prisma.inventoryItem.findMany({
      where: { householdId }, include: { ingredient: true }, orderBy: [{ ingredient: { name: 'asc' } }, { location: 'asc' }],
    }) };
  }

  async set(userId: string, householdId: string, dto: SetInventoryItemDto) {
    await this.requireMember(userId, householdId);
    const ingredient = await this.prisma.ingredient.upsert({
      where: { householdId_name: { householdId, name: dto.name.trim() } },
      update: { defaultUnit: dto.unit.trim() },
      create: { householdId, name: dto.name.trim(), defaultUnit: dto.unit.trim() },
    });
    const current = await this.prisma.inventoryItem.findFirst({ where: { householdId, ingredientId: ingredient.id, unit: dto.unit.trim(), location: dto.location?.trim() ?? null } });
    if (!current) {
      const created = await this.prisma.inventoryItem.create({ data: { householdId, ingredientId: ingredient.id, quantity: dto.quantity, unit: dto.unit.trim(), location: dto.location?.trim() }, include: { ingredient: true } });
      if (dto.quantity !== 0) await this.prisma.inventoryTransaction.create({ data: { inventoryItemId: created.id, type: 'ADJUST', quantityDelta: dto.quantity, reason: '设置库存' } });
      return { data: created };
    }
    const delta = dto.quantity - Number(current.quantity);
    const updated = await this.prisma.inventoryItem.update({ where: { id: current.id }, data: { quantity: dto.quantity }, include: { ingredient: true } });
    if (delta !== 0) await this.prisma.inventoryTransaction.create({ data: { inventoryItemId: current.id, type: 'ADJUST', quantityDelta: delta, reason: '调整库存' } });
    return { data: updated };
  }

  private async requireMember(userId: string, householdId: string) {
    const membership = await this.prisma.membership.findFirst({ where: { householdId, userId, status: 'ACTIVE' } });
    if (!membership) throw new ForbiddenException('No access to this household');
  }
}
