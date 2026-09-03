import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { FavoriteConversionTarget, FavoriteType, Prisma, RecipeStatus, TaskPriority, TaskStatus, TaskType } from '@prisma/client';
import { AccessService } from '../access/access.service';
import { permits } from '../access/permission-policy';
import { PrismaService } from '../prisma/prisma.service';
import { serializable } from '../prisma/serializable';
import { ArchiveFavoriteDto, ConvertFavoriteDto, CreateFavoriteDto, UpdateFavoriteDto } from './favorites.dto';

const favoriteInclude = { createdBy: { include: { user: { select: { id: true, nickname: true, avatarUrl: true } } } }, conversions: { orderBy: { createdAt: 'desc' as const } } } as const;

@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService) {}

  async list(userId: string, householdId: string) {
    const member = await this.access.require(userId, householdId, 'favorites');
    const canManage = permits(member.effectivePermissions, 'favorites', 'MANAGE');
    return { data: await this.prisma.favorite.findMany({
      where: { householdId, archivedAt: null, ...(canManage ? {} : { OR: [{ visibility: 'HOUSEHOLD' as const }, { createdById: member.id }] }) },
      include: favoriteInclude,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    }) };
  }

  async detail(userId: string, householdId: string, favoriteId: string) {
    const member = await this.access.require(userId, householdId, 'favorites');
    return { data: await this.visibleOrThrow(this.prisma, householdId, favoriteId, member.id, permits(member.effectivePermissions, 'favorites', 'MANAGE')) };
  }

  async create(userId: string, householdId: string, dto: CreateFavoriteDto) {
    const member = await this.access.require(userId, householdId, 'favorites', 'EDIT');
    this.validateContent(dto.type, dto.text, dto.sourceUrl);
    const favorite = await this.prisma.favorite.create({ data: {
      householdId,
      type: dto.type,
      title: dto.title.trim(),
      text: dto.text?.trim() || null,
      sourceUrl: dto.sourceUrl?.trim() || null,
      tags: this.tags(dto.tags),
      visibility: dto.visibility,
      createdById: member.id,
    }, include: favoriteInclude });
    await this.audit(this.prisma, householdId, member.id, 'FAVORITE_CREATE', favorite.id, { type: favorite.type, visibility: favorite.visibility });
    return { data: favorite };
  }

  async update(userId: string, householdId: string, favoriteId: string, dto: UpdateFavoriteDto) {
    return serializable(this.prisma, async tx => {
      const member = await this.access.require(userId, householdId, 'favorites', 'EDIT', tx);
      const favorite = await this.ownedOrManaged(tx, householdId, favoriteId, member);
      if (favorite.version !== dto.expectedVersion) throw new ConflictException('收藏已更新，请刷新后重试');
      const type = dto.type ?? favorite.type;
      const text = dto.text === undefined ? favorite.text : dto.text?.trim() || null;
      const sourceUrl = dto.sourceUrl === undefined ? favorite.sourceUrl : dto.sourceUrl?.trim() || null;
      this.validateContent(type, text, sourceUrl);
      const changed = await tx.favorite.updateMany({ where: { id: favoriteId, householdId, archivedAt: null, version: dto.expectedVersion }, data: {
        type,
        title: dto.title?.trim(),
        text,
        sourceUrl,
        tags: dto.tags === undefined ? undefined : this.tags(dto.tags),
        visibility: dto.visibility,
        version: { increment: 1 },
      } });
      if (!changed.count) throw new ConflictException('收藏已更新，请刷新后重试');
      await this.audit(tx, householdId, member.id, 'FAVORITE_UPDATE', favoriteId, { fromVersion: favorite.version, toVersion: favorite.version + 1 });
      return { data: await tx.favorite.findUniqueOrThrow({ where: { id: favoriteId }, include: favoriteInclude }) };
    });
  }

  async archive(userId: string, householdId: string, favoriteId: string, dto: ArchiveFavoriteDto) {
    return serializable(this.prisma, async tx => {
      const member = await this.access.require(userId, householdId, 'favorites', 'EDIT', tx);
      const favorite = await this.ownedOrManaged(tx, householdId, favoriteId, member);
      if (favorite.version !== dto.expectedVersion) throw new ConflictException('收藏已更新，请刷新后重试');
      const changed = await tx.favorite.updateMany({ where: { id: favoriteId, householdId, archivedAt: null, version: dto.expectedVersion }, data: { archivedAt: new Date(), version: { increment: 1 } } });
      if (!changed.count) throw new ConflictException('收藏已更新，请刷新后重试');
      await this.audit(tx, householdId, member.id, 'FAVORITE_ARCHIVE', favoriteId, { fromVersion: favorite.version, toVersion: favorite.version + 1 });
      return { data: { archived: true, id: favoriteId } };
    });
  }

  async convert(userId: string, householdId: string, favoriteId: string, dto: ConvertFavoriteDto) {
    return serializable(this.prisma, async tx => {
      const member = await this.access.require(userId, householdId, 'favorites', 'EDIT', tx);
      const favorite = await this.visibleOrThrow(tx, householdId, favoriteId, member.id, permits(member.effectivePermissions, 'favorites', 'MANAGE'));
      const repeated = await tx.favoriteConversion.findUnique({ where: { actorMembershipId_idempotencyKey: { actorMembershipId: member.id, idempotencyKey: dto.idempotencyKey } } });
      if (repeated) {
        if (repeated.favoriteId !== favoriteId || repeated.targetType !== dto.targetType) throw new ConflictException('该请求标识已用于其他转换');
        return { data: { targetId: repeated.targetId, targetType: repeated.targetType, status: 'DRAFT', repeated: true } };
      }
      if (favorite.version !== dto.expectedVersion) throw new ConflictException('收藏已更新，请刷新后重试');
      const title = dto.confirmedTitle.trim();
      let targetId: string;
      if (dto.targetType === FavoriteConversionTarget.RECIPE) {
        await this.access.require(userId, householdId, 'recipes', 'EDIT', tx);
        const recipe = await tx.recipe.create({ data: { householdId, name: title, status: RecipeStatus.DRAFT, steps: [], createdById: member.id } });
        targetId = recipe.id;
      } else if (dto.targetType === FavoriteConversionTarget.TASK) {
        await this.access.require(userId, householdId, 'tasks', 'EDIT', tx);
        const source = [dto.confirmedDescription?.trim(), favorite.text, favorite.sourceUrl].filter(Boolean).join('\n\n').slice(0, 2000) || null;
        const task = await tx.task.create({ data: { householdId, type: TaskType.TODO, title, description: source, assigneeMembershipId: member.id, priority: TaskPriority.NORMAL, status: TaskStatus.PENDING, createdById: member.id } });
        await tx.taskHistory.create({ data: { taskId: task.id, actorMembershipId: member.id, toStatus: TaskStatus.PENDING, comment: '由收藏灵感转换为待办草稿' } });
        targetId = task.id;
      } else {
        throw new BadRequestException('不支持的转换目标');
      }
      await tx.favoriteConversion.create({ data: { favoriteId, targetType: dto.targetType, targetId, actorMembershipId: member.id, idempotencyKey: dto.idempotencyKey } });
      await this.audit(tx, householdId, member.id, 'FAVORITE_CONVERT', favoriteId, { targetType: dto.targetType, targetId, sourcePreserved: true });
      return { data: { targetId, targetType: dto.targetType, status: 'DRAFT', repeated: false } };
    });
  }

  private async visibleOrThrow(tx: Prisma.TransactionClient | PrismaService, householdId: string, favoriteId: string, memberId: string, canManage = false) {
    const favorite = await tx.favorite.findFirst({ where: { id: favoriteId, householdId, archivedAt: null, ...(canManage ? {} : { OR: [{ visibility: 'HOUSEHOLD' as const }, { createdById: memberId }] }) }, include: favoriteInclude });
    if (!favorite) throw new NotFoundException('收藏不存在');
    return favorite;
  }

  private async ownedOrManaged(tx: Prisma.TransactionClient, householdId: string, favoriteId: string, member: Awaited<ReturnType<AccessService['require']>>) {
    const favorite = await tx.favorite.findFirst({ where: { id: favoriteId, householdId, archivedAt: null } });
    if (!favorite) throw new NotFoundException('收藏不存在');
    if (favorite.createdById !== member.id && !permits(member.effectivePermissions, 'favorites', 'MANAGE')) throw new ForbiddenException('只能维护自己的收藏');
    return favorite;
  }

  private validateContent(type: FavoriteType, text?: string | null, sourceUrl?: string | null) {
    if (type === FavoriteType.LINK && !sourceUrl) throw new BadRequestException('链接收藏必须填写网址');
    if (type === FavoriteType.TEXT && !text?.trim()) throw new BadRequestException('文字收藏必须填写内容');
  }

  private tags(values: string[]): Prisma.InputJsonValue {
    return [...new Set(values.map(value => value.trim()).filter(Boolean))];
  }

  private async audit(tx: Prisma.TransactionClient | PrismaService, householdId: string, actorMembershipId: string, action: string, targetId: string, details: Prisma.InputJsonValue) {
    await tx.auditLog.create({ data: { householdId, actorMembershipId, action, targetId, details } });
  }
}
