import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ArchiveValueType, ArchiveVisibility, Prisma } from '@prisma/client';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AccessService } from '../access/access.service';
import { permits } from '../access/permission-policy';
import { PrismaService } from '../prisma/prisma.service';
import { serializable } from '../prisma/serializable';
import { ArchiveFieldGrantDto, ArchiveFieldVersionDto, CreateArchiveFieldDto, SetArchiveValueDto, UpdateArchiveFieldDto } from './archive.dto';

const fieldInclude = { value: { select: { version: true, updatedAt: true } }, grants: true } as const;
type ArchiveField = Prisma.ArchiveFieldDefinitionGetPayload<{ include: typeof fieldInclude }>;

@Injectable()
export class ArchiveService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly config: ConfigService) {}

  async list(userId: string, householdId: string) {
    const member = await this.access.require(userId, householdId, 'archive');
    const manage = permits(member.effectivePermissions, 'archive', 'MANAGE');
    const fields = await this.prisma.archiveFieldDefinition.findMany({ where: { householdId, archivedAt: null }, include: fieldInclude, orderBy: [{ label: 'asc' }, { id: 'asc' }] });
    return { data: fields.filter(field => this.canRead(field, member.id, manage)).map(field => this.summary(field, member.id, manage, permits(member.effectivePermissions, 'archive', 'EDIT'))) };
  }

  async createField(userId: string, householdId: string, dto: CreateArchiveFieldDto) {
    return serializable(this.prisma, async tx => {
      const member = await this.access.require(userId, householdId, 'archive', 'MANAGE', tx);
      const grants = this.normalizeGrants(dto.grants);
      await this.requireGrantMembers(tx, householdId, grants);
      const field = await tx.archiveFieldDefinition.create({ data: { householdId, key: dto.key, label: dto.label, valueType: dto.valueType, sensitive: dto.sensitive, visibility: dto.visibility, grants: { create: grants } }, include: fieldInclude });
      await this.audit(tx, householdId, member.id, 'ARCHIVE_FIELD_CREATE', field.id, { key: field.key, valueType: field.valueType, sensitive: field.sensitive, visibility: field.visibility, grantCount: grants.length });
      return { data: this.summary(field, member.id, true, true) };
    });
  }

  async updateField(userId: string, householdId: string, fieldId: string, dto: UpdateArchiveFieldDto) {
    return serializable(this.prisma, async tx => {
      const member = await this.access.require(userId, householdId, 'archive', 'MANAGE', tx);
      const field = await this.fieldOrThrow(tx, householdId, fieldId);
      if (field.version !== dto.expectedVersion) throw new ConflictException('档案字段已更新，请刷新后重试');
      if (dto.valueType && dto.valueType !== field.valueType && field.value) throw new ConflictException('已有内容的档案字段不能直接更换类型，请新建字段后迁移');
      const grants = dto.grants === undefined ? undefined : this.normalizeGrants(dto.grants);
      if (grants) await this.requireGrantMembers(tx, householdId, grants);
      const changed = await tx.archiveFieldDefinition.updateMany({ where: { id: fieldId, householdId, archivedAt: null, version: dto.expectedVersion }, data: { label: dto.label, valueType: dto.valueType, sensitive: dto.sensitive, visibility: dto.visibility, version: { increment: 1 } } });
      if (!changed.count) throw new ConflictException('档案字段已更新，请刷新后重试');
      if (grants) {
        await tx.archiveFieldGrant.deleteMany({ where: { fieldId } });
        if (grants.length) await tx.archiveFieldGrant.createMany({ data: grants.map(grant => ({ fieldId, ...grant })) });
      }
      await this.audit(tx, householdId, member.id, 'ARCHIVE_FIELD_UPDATE', fieldId, { fromVersion: field.version, toVersion: field.version + 1, grantCount: grants?.length ?? field.grants.length });
      const updated = await this.fieldOrThrow(tx, householdId, fieldId);
      return { data: this.summary(updated, member.id, true, true) };
    });
  }

  async archiveField(userId: string, householdId: string, fieldId: string, dto: ArchiveFieldVersionDto) {
    return serializable(this.prisma, async tx => {
      const member = await this.access.require(userId, householdId, 'archive', 'MANAGE', tx);
      const field = await this.fieldOrThrow(tx, householdId, fieldId);
      if (field.version !== dto.expectedVersion) throw new ConflictException('档案字段已更新，请刷新后重试');
      const changed = await tx.archiveFieldDefinition.updateMany({ where: { id: fieldId, householdId, archivedAt: null, version: dto.expectedVersion }, data: { archivedAt: new Date(), version: { increment: 1 } } });
      if (!changed.count) throw new ConflictException('档案字段已更新，请刷新后重试');
      await this.audit(tx, householdId, member.id, 'ARCHIVE_FIELD_ARCHIVE', fieldId, { hadValue: Boolean(field.value) });
      return { data: { id: fieldId, archived: true } };
    });
  }

  async readValue(userId: string, householdId: string, fieldId: string) {
    const member = await this.access.require(userId, householdId, 'archive');
    const field = await this.fieldOrThrow(this.prisma, householdId, fieldId);
    const manage = permits(member.effectivePermissions, 'archive', 'MANAGE');
    if (!this.canRead(field, member.id, manage)) throw new NotFoundException('档案字段不存在');
    const stored = await this.prisma.archiveFieldValue.findUnique({ where: { fieldId } });
    const value = stored ? this.decrypt(householdId, fieldId, stored.keyVersion, stored.valueCiphertext, stored.nonce, stored.authTag) : null;
    await this.audit(this.prisma, householdId, member.id, 'ARCHIVE_VALUE_READ', fieldId, { sensitive: field.sensitive, hasValue: Boolean(stored) });
    return { data: { field: this.summary(field, member.id, manage, permits(member.effectivePermissions, 'archive', 'EDIT')), value, valueVersion: stored?.version ?? 0, updatedAt: stored?.updatedAt ?? null } };
  }

  async setValue(userId: string, householdId: string, fieldId: string, dto: SetArchiveValueDto) {
    return serializable(this.prisma, async tx => {
      const member = await this.access.require(userId, householdId, 'archive', 'EDIT', tx);
      const field = await this.fieldOrThrow(tx, householdId, fieldId);
      const manage = permits(member.effectivePermissions, 'archive', 'MANAGE');
      if (!this.canEdit(field, member.id, manage, true)) throw new ForbiddenException('当前账号没有该档案字段的编辑权限');
      this.validateValue(field.valueType, dto.value);
      const existing = await tx.archiveFieldValue.findUnique({ where: { fieldId } });
      if ((existing?.version ?? 0) !== dto.expectedVersion) throw new ConflictException('档案内容已更新，请刷新后重试');
      const encrypted = this.encrypt(householdId, fieldId, dto.value);
      let version: number;
      if (existing) {
        const changed = await tx.archiveFieldValue.updateMany({ where: { fieldId, version: dto.expectedVersion }, data: { ...encrypted, updatedById: member.id, version: { increment: 1 } } });
        if (!changed.count) throw new ConflictException('档案内容已更新，请刷新后重试');
        version = existing.version + 1;
      } else {
        const created = await tx.archiveFieldValue.create({ data: { fieldId, ...encrypted, updatedById: member.id } });
        version = created.version;
      }
      await this.audit(tx, householdId, member.id, 'ARCHIVE_VALUE_UPDATE', fieldId, { fromVersion: existing?.version ?? 0, toVersion: version, sensitive: field.sensitive });
      return { data: { fieldId, valueVersion: version, updatedAt: new Date().toISOString() } };
    });
  }

  private async fieldOrThrow(tx: Prisma.TransactionClient | PrismaService, householdId: string, fieldId: string) {
    const field = await tx.archiveFieldDefinition.findFirst({ where: { id: fieldId, householdId, archivedAt: null }, include: fieldInclude });
    if (!field) throw new NotFoundException('档案字段不存在');
    return field;
  }

  private summary(field: ArchiveField, memberId: string, manage: boolean, hasEditPermission: boolean) {
    return { id: field.id, key: field.key, label: field.label, valueType: field.valueType, sensitive: field.sensitive, visibility: field.visibility, version: field.version, hasValue: Boolean(field.value), valueVersion: field.value?.version ?? 0, updatedAt: field.value?.updatedAt ?? null, canEdit: this.canEdit(field, memberId, manage, hasEditPermission), ...(manage ? { grants: field.grants } : {}) };
  }

  private canRead(field: ArchiveField, memberId: string, manage: boolean) {
    if (manage) return true;
    if (field.visibility === ArchiveVisibility.MEMBERS) return true;
    if (field.visibility === ArchiveVisibility.SELECTED) return field.grants.some(grant => grant.membershipId === memberId && grant.canRead);
    return false;
  }

  private canEdit(field: ArchiveField, memberId: string, manage: boolean, hasEditPermission: boolean) {
    if (manage) return true;
    if (!hasEditPermission || field.visibility === ArchiveVisibility.MANAGERS) return false;
    return field.grants.some(grant => grant.membershipId === memberId && grant.canEdit && grant.canRead);
  }

  private normalizeGrants(grants: ArchiveFieldGrantDto[]) {
    const unique = new Map<string, ArchiveFieldGrantDto>();
    for (const grant of grants) {
      if (grant.canEdit && !grant.canRead) throw new BadRequestException('档案字段可编辑成员必须同时可读');
      if (unique.has(grant.membershipId)) throw new BadRequestException('档案字段授权成员不能重复');
      unique.set(grant.membershipId, { membershipId: grant.membershipId, canRead: grant.canRead, canEdit: grant.canEdit });
    }
    return [...unique.values()];
  }

  private async requireGrantMembers(tx: Prisma.TransactionClient, householdId: string, grants: ArchiveFieldGrantDto[]) {
    if (!grants.length) return;
    const count = await tx.membership.count({ where: { householdId, status: 'ACTIVE', id: { in: grants.map(grant => grant.membershipId) } } });
    if (count !== grants.length) throw new BadRequestException('档案字段只能授权给当前家庭的有效成员');
  }

  private validateValue(type: ArchiveValueType, value: string) {
    if (type !== ArchiveValueType.DATE) return;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) throw new BadRequestException('日期档案必须使用 YYYY-MM-DD');
    const [year, month, day] = match.slice(1).map(Number), date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new BadRequestException('日期档案不是有效日期');
  }

  private key() {
    const encoded = this.config.get<string>('ARCHIVE_ENCRYPTION_KEY') || '';
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32) throw new ServiceUnavailableException('家庭档案加密密钥尚未配置');
    return key;
  }

  private encrypt(householdId: string, fieldId: string, value: string) {
    const keyVersion = this.config.get<number>('ARCHIVE_ENCRYPTION_KEY_VERSION') || 1, nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), nonce);
    cipher.setAAD(Buffer.from(`${householdId}:${fieldId}:v${keyVersion}`));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return { valueCiphertext: ciphertext.toString('base64'), nonce: nonce.toString('base64'), authTag: cipher.getAuthTag().toString('base64'), keyVersion };
  }

  private decrypt(householdId: string, fieldId: string, keyVersion: number, valueCiphertext: string, nonce: string, authTag: string) {
    const currentVersion = this.config.get<number>('ARCHIVE_ENCRYPTION_KEY_VERSION') || 1;
    if (keyVersion !== currentVersion) throw new ServiceUnavailableException('家庭档案密钥版本不可用');
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(nonce, 'base64'));
      decipher.setAAD(Buffer.from(`${householdId}:${fieldId}:v${keyVersion}`));
      decipher.setAuthTag(Buffer.from(authTag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(valueCiphertext, 'base64')), decipher.final()]).toString('utf8');
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('家庭档案内容校验失败');
    }
  }

  private async audit(tx: Prisma.TransactionClient | PrismaService, householdId: string, actorMembershipId: string, action: string, targetId: string, details: Prisma.InputJsonValue) {
    await tx.auditLog.create({ data: { householdId, actorMembershipId, action, targetId, details } });
  }
}
