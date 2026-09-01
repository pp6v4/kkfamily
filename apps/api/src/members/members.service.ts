import { BadRequestException, ConflictException, ForbiddenException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { AccessService, householdIdOrThrow } from '../access/access.service';
import { effectivePermissions, ModuleCode, Override, Permissions, permits, ROLE_DEFAULTS } from '../access/permission-policy';
import { PrismaService } from '../prisma/prisma.service';
import { serializable } from '../prisma/serializable';
import { CreateInvitationDto, PermissionsDto, StatusDto, TransferAdminDto } from './members.dto';

const rolesInclude = { roles: { include: { role: true } }, permissions: true } as const;
const memberInclude = { ...rolesInclude, user: { select: { id: true, nickname: true, avatarUrl: true } } } as const;
const inviteSelect = { id: true, householdId: true, roleCodes: true, grants: true, expiresAt: true, maxUses: true, usedCount: true, revokedAt: true, version: true, createdAt: true } as const;
type Member = Prisma.MembershipGetPayload<{ include: typeof memberInclude }>;

@Injectable()
export class MembersService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService) {}

  async current(userId: string, householdId: string) {
    const member = await this.access.member(userId, householdId);
    return { data: { membershipId: member.id, version: member.version, permissionVersion: member.permissionVersion, roles: member.roles.map(r => r.role.code), effectivePermissions: member.effectivePermissions } };
  }

  async catalog(userId: string, householdId: string) {
    await this.access.require(userId, householdId, 'members', 'MANAGE');
    return { data: ROLE_DEFAULTS };
  }

  async list(userId: string, householdId: string, cursor?: string) {
    const actor = await this.access.require(userId, householdId, 'members');
    const manager = permits(actor.effectivePermissions, 'members', 'MANAGE');
    const members = await this.prisma.membership.findMany({
      where: { householdId, ...(manager ? {} : { status: 'ACTIVE' as const }), ...(cursor ? { id: { gt: cursor } } : {}) },
      include: memberInclude, orderBy: { id: 'asc' }, take: 101,
    });
    return { data: { items: members.slice(0, 100).map(member => manager ? this.summary(member) : { id: member.id, user: member.user }), nextCursor: members.length > 100 ? members[99].id : null } };
  }

  async invitations(userId: string, householdId: string) {
    await this.access.require(userId, householdId, 'members', 'MANAGE');
    return { data: await this.prisma.householdInvitation.findMany({ where: { householdId }, select: inviteSelect, orderBy: { createdAt: 'desc' }, take: 100 }) };
  }

  async createInvitation(userId: string, householdId: string, dto: CreateInvitationDto) {
    const code = randomBytes(24).toString('base64url');
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : new Date(Date.now() + 48 * 3600_000);
    if (expiresAt.getTime() <= Date.now() || expiresAt.getTime() > Date.now() + 7 * 86400_000) throw new BadRequestException('邀请有效期须在未来7天内');
    const invitation = await serializable(this.prisma, async tx => {
      const actor = await this.access.require(userId, householdId, 'members', 'MANAGE', tx);
      if (dto.roleCodes.includes('ADMIN')) throw new BadRequestException('邀请码不授予管理员角色');
      this.assertAssignable(actor.effectivePermissions, dto.roleCodes, dto.grants);
      const invite = await tx.householdInvitation.create({ data: { householdId, codeHash: this.hash(code), roleCodes: dto.roleCodes, grants: dto.grants.map(g => ({ ...g })), expiresAt, maxUses: dto.maxUses ?? 1, createdById: actor.id }, select: inviteSelect });
      await this.audit(tx, householdId, actor.id, 'INVITATION_CREATE', invite.id, { roleCodes: dto.roleCodes, grants: dto.grants.map(g => ({ ...g })) });
      return invite;
    });
    return { data: { ...invitation, code } };
  }

  async redeem(userId: string, code: string) {
    return { data: await serializable(this.prisma, async tx => {
      const invitation = await tx.householdInvitation.findUnique({ where: { codeHash: this.hash(code) } });
      if (!invitation) throw new GoneException('邀请码无效或已失效');
      const previous = await tx.invitationRedemption.findUnique({ where: { invitationId_userId: { invitationId: invitation.id, userId } }, include: { membership: { include: { ...memberInclude, household: { select: { id: true, name: true } } } } } });
      if (previous) {
        if (previous.membership.status !== 'ACTIVE') throw new ForbiddenException('成员已停用，请联系管理员');
        return { ...this.summary(previous.membership), household: previous.membership.household };
      }
      if (invitation.revokedAt || invitation.expiresAt.getTime() <= Date.now() || invitation.usedCount >= invitation.maxUses) throw new GoneException('邀请码无效或已失效');
      const issuer = await tx.membership.findUnique({ where: { id: invitation.createdById } });
      if (!issuer) throw new GoneException('邀请发起人已失效');
      const actor = await this.access.require(issuer.userId, invitation.householdId, 'members', 'MANAGE', tx);
      const grants = invitation.grants as unknown as Override[];
      this.assertAssignable(actor.effectivePermissions, invitation.roleCodes, grants);
      const existing = await tx.membership.findUnique({ where: { householdId_userId: { householdId: invitation.householdId, userId } }, include: { ...memberInclude, household: { select: { id: true, name: true } } } });
      if (existing?.status === 'ACTIVE') return { ...this.summary(existing), household: existing.household };
      if (existing && existing.status !== 'PENDING') throw new ForbiddenException('不能通过邀请码恢复已停用或离开的成员');
      const member = existing
        ? await tx.membership.update({ where: { id: existing.id }, data: { status: 'ACTIVE', version: { increment: 1 }, permissionVersion: { increment: 1 } } })
        : await tx.membership.create({ data: { householdId: invitation.householdId, userId, status: 'ACTIVE' } });
      await this.assign(tx, member.id, invitation.roleCodes, grants);
      await tx.invitationRedemption.create({ data: { invitationId: invitation.id, userId, membershipId: member.id } });
      await tx.householdInvitation.update({ where: { id: invitation.id }, data: { usedCount: { increment: 1 }, version: { increment: 1 } } });
      await this.audit(tx, member.householdId, member.id, 'INVITATION_REDEEM', member.id, { invitationId: invitation.id });
      const result = await tx.membership.findUniqueOrThrow({ where: { id: member.id }, include: { ...memberInclude, household: { select: { id: true, name: true } } } });
      return { ...this.summary(result), household: result.household };
    }) };
  }

  async revokeInvitation(userId: string, householdId: string, id: string, version: number) {
    return { data: await serializable(this.prisma, async tx => {
      const actor = await this.access.require(userId, householdId, 'members', 'MANAGE', tx);
      const invite = await tx.householdInvitation.findFirst({ where: { id, householdId } });
      if (!invite) throw new NotFoundException('邀请不存在');
      if (invite.version !== version) throw new ConflictException('邀请已更新，请刷新');
      if (!invite.revokedAt) {
        await tx.householdInvitation.update({ where: { id }, data: { revokedAt: new Date(), version: { increment: 1 } } });
        await this.audit(tx, householdId, actor.id, 'INVITATION_REVOKE', id, {});
      }
      return { revoked: true };
    }) };
  }

  async changePermissions(userId: string, householdId: string, id: string, dto: PermissionsDto) {
    return { data: await serializable(this.prisma, async tx => {
      const actor = await this.access.require(userId, householdId, 'members', 'MANAGE', tx);
      const target = await this.target(tx, householdId, id, dto.version);
      this.assertAssignable(actor.effectivePermissions, dto.roleCodes, dto.overrides);
      if (dto.roleCodes.includes('ADMIN') && !actor.roles.some(r => r.role.code === 'ADMIN')) throw new ForbiddenException('仅管理员可授予管理员角色');
      const before = this.summary(target);
      await this.assign(tx, id, dto.roleCodes, dto.overrides);
      const result = await tx.membership.update({ where: { id }, data: { version: { increment: 1 }, permissionVersion: { increment: 1 } }, include: memberInclude });
      await this.assertAdministratorRemains(tx, householdId);
      await this.audit(tx, householdId, actor.id, 'MEMBER_PERMISSIONS', id, { before: { roles: before.roles, overrides: before.overrides }, after: { roles: dto.roleCodes, overrides: dto.overrides.map(g => ({ ...g })) } });
      return this.summary(result);
    }) };
  }

  async changeStatus(userId: string, householdId: string, id: string, dto: StatusDto) {
    return { data: await serializable(this.prisma, async tx => {
      const actor = await this.access.require(userId, householdId, 'members', 'MANAGE', tx);
      const target = await this.target(tx, householdId, id, dto.version);
      if (dto.status === 'ACTIVE') this.assertAssignable(actor.effectivePermissions, target.roles.map(r => r.role.code), target.permissions);
      const result = await tx.membership.update({ where: { id }, data: { status: dto.status, version: { increment: 1 }, permissionVersion: { increment: 1 } }, include: memberInclude });
      await this.assertAdministratorRemains(tx, householdId);
      await this.audit(tx, householdId, actor.id, 'MEMBER_STATUS', id, { before: target.status, after: dto.status });
      return this.summary(result);
    }) };
  }

  async transfer(userId: string, householdId: string, dto: TransferAdminDto) {
    return { data: await serializable(this.prisma, async tx => {
      const actor = await this.access.require(userId, householdId, 'members', 'MANAGE', tx);
      if (!actor.roles.some(r => r.role.code === 'ADMIN')) throw new ForbiddenException('仅管理员可转让');
      if (actor.version !== dto.version) throw new ConflictException('当前成员权限已变化');
      if (actor.id === dto.targetMembershipId) throw new BadRequestException('请选择其他成员');
      const target = await this.target(tx, householdId, dto.targetMembershipId, dto.targetVersion);
      if (target.status !== 'ACTIVE') throw new BadRequestException('目标必须是有效家庭成员');
      const admin = await tx.role.upsert({ where: { code: 'ADMIN' }, update: {}, create: { code: 'ADMIN', name: '管理员' } });
      // Do not override explicit DENY as a side effect of transfer.
      const next = effectivePermissions([...target.roles.map(r => r.role.code), 'ADMIN'], target.permissions);
      this.assertAssignable(actor.effectivePermissions, [...target.roles.map(r => r.role.code), 'ADMIN'], target.permissions);
      if (!permits(next, 'members', 'MANAGE')) throw new BadRequestException('请先明确调整目标的成员管理限制，再转让');
      await tx.memberRole.upsert({ where: { membershipId_roleId: { membershipId: target.id, roleId: admin.id } }, create: { membershipId: target.id, roleId: admin.id }, update: {} });
      await tx.memberRole.deleteMany({ where: { membershipId: actor.id, roleId: admin.id } });
      await tx.membership.updateMany({ where: { id: { in: [actor.id, target.id] } }, data: { version: { increment: 1 }, permissionVersion: { increment: 1 } } });
      await this.assertAdministratorRemains(tx, householdId);
      await this.audit(tx, householdId, actor.id, 'ADMIN_TRANSFER', target.id, { previousAdministrator: actor.id });
      return this.summary(await tx.membership.findUniqueOrThrow({ where: { id: target.id }, include: memberInclude }));
    }) };
  }

  private assertAssignable(actor: Permissions, roles: string[], overrides: Override[]) {
    if (roles.some(r => !ROLE_DEFAULTS[r])) throw new BadRequestException('未知角色');
    if (new Set(overrides.map(g => g.module)).size !== overrides.length) throw new BadRequestException('同一模块只能配置一条覆盖规则');
    for (const [module, level] of Object.entries(effectivePermissions(roles, overrides))) if (!permits(actor, module as ModuleCode, level)) throw new ForbiddenException('不能授出高于自己的权限');
  }

  private async assign(tx: Prisma.TransactionClient, id: string, codes: string[], overrides: Override[]) {
    await tx.memberRole.deleteMany({ where: { membershipId: id } });
    for (const code of codes) {
      const role = await tx.role.upsert({ where: { code }, update: {}, create: { code, name: code } });
      await tx.memberRole.create({ data: { membershipId: id, roleId: role.id } });
    }
    await tx.modulePermission.deleteMany({ where: { membershipId: id } });
    if (overrides.length) await tx.modulePermission.createMany({ data: overrides.map(g => ({ membershipId: id, ...g })) });
  }

  private async target(tx: Prisma.TransactionClient, householdId: string, id: string, version: number) {
    householdIdOrThrow(householdId);
    const target = await tx.membership.findFirst({ where: { id, householdId }, include: memberInclude });
    if (!target) throw new NotFoundException('成员不存在');
    if (target.version !== version) throw new ConflictException('成员已更新，请刷新后重试');
    return target;
  }

  private async assertAdministratorRemains(tx: Prisma.TransactionClient, householdId: string) {
    const admins = await tx.membership.findMany({ where: { householdId, status: 'ACTIVE', roles: { some: { role: { code: 'ADMIN' } } } }, include: rolesInclude });
    if (!admins.some(m => permits(effectivePermissions(m.roles.map(r => r.role.code), m.permissions), 'members', 'MANAGE'))) throw new ConflictException('必须保留至少一名可管理成员的有效管理员');
  }

  private summary(member: Member) {
    return { id: member.id, membershipId: member.id, user: member.user, status: member.status, version: member.version, permissionVersion: member.permissionVersion, roles: member.roles.map(r => r.role.code), overrides: member.permissions.map(g => ({ module: g.module, level: g.level, effect: g.effect })), effectivePermissions: effectivePermissions(member.roles.map(r => r.role.code), member.permissions) };
  }
  private hash(code: string) { return createHash('sha256').update(code).digest('hex'); }
  private audit(tx: Prisma.TransactionClient, householdId: string, actorMembershipId: string, action: string, targetId: string, details: Prisma.InputJsonObject) {
    return tx.auditLog.create({ data: { householdId, actorMembershipId, action, targetId, details } });
  }
}
