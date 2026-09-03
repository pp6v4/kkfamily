import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationEventType, Prisma } from '@prisma/client';
import { AccessService } from '../access/access.service';
import { permits } from '../access/permission-policy';
import { PrismaService } from '../prisma/prisma.service';
import { serializable } from '../prisma/serializable';
import { ReadInboxItemDto, RecordSubscriptionReceiptDto, UpdateNotificationPreferenceDto } from './notifications.dto';

const defaultPreference = { eventType: NotificationEventType.TASK_REMINDER, enabled: true, leadMinutes: 0, quietStart: '22:00', quietEnd: '08:00', version: 0 } as const;

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly config: ConfigService) {}

  async listInbox(userId: string, householdId: string) {
    const member = await this.access.require(userId, householdId, 'notifications');
    const rows = await this.prisma.inboxItem.findMany({ where: { recipientMembershipId: member.id, invalidatedAt: null }, orderBy: [{ readAt: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }], take: 100 });
    const data: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      if (row.sourceType !== 'TASK' || !permits(member.effectivePermissions, 'tasks')) { await this.invalidate(row.id); continue; }
      const task = await this.prisma.task.findFirst({ where: { id: row.sourceId, householdId, archivedAt: null, status: { not: 'CANCELLED' }, assigneeMembershipId: member.id }, select: { title: true, status: true, reminderAt: true } });
      if (!task) { await this.invalidate(row.id); continue; }
      data.push({ id: row.id, version: row.version, sourceType: row.sourceType, sourceId: row.sourceId, title: task.title, status: task.status, reminderAt: task.reminderAt, readAt: row.readAt, createdAt: row.createdAt });
    }
    return { data };
  }

  async markRead(userId: string, householdId: string, itemId: string, dto: ReadInboxItemDto) {
    const member = await this.access.require(userId, householdId, 'notifications');
    const item = await this.prisma.inboxItem.findFirst({ where: { id: itemId, recipientMembershipId: member.id, invalidatedAt: null } });
    if (!item) throw new NotFoundException('消息不存在');
    if (item.readAt && (item.version === dto.expectedVersion || item.version === dto.expectedVersion + 1)) return { data: item };
    if (item.version !== dto.expectedVersion) throw new ConflictException('消息已更新，请刷新后重试');
    const changed = await this.prisma.inboxItem.updateMany({ where: { id: itemId, recipientMembershipId: member.id, invalidatedAt: null, version: dto.expectedVersion }, data: { readAt: new Date(), version: { increment: 1 } } });
    if (!changed.count) throw new ConflictException('消息已更新，请刷新后重试');
    return { data: await this.prisma.inboxItem.findUniqueOrThrow({ where: { id: itemId } }) };
  }

  async preferences(userId: string, householdId: string) {
    const member = await this.access.require(userId, householdId, 'notifications');
    const saved = await this.prisma.notificationPreference.findUnique({ where: { membershipId_eventType: { membershipId: member.id, eventType: NotificationEventType.TASK_REMINDER } } });
    return { data: [saved || { membershipId: member.id, ...defaultPreference }] };
  }

  async updatePreference(userId: string, householdId: string, dto: UpdateNotificationPreferenceDto) {
    return serializable(this.prisma, async tx => {
      const member = await this.access.require(userId, householdId, 'notifications', 'VIEW', tx);
      if ((dto.quietStart === null) !== (dto.quietEnd === null)) throw new BadRequestException('安静时段开始和结束必须同时填写或同时清空');
      const existing = await tx.notificationPreference.findUnique({ where: { membershipId_eventType: { membershipId: member.id, eventType: dto.eventType } } });
      if ((existing?.version ?? 0) !== dto.expectedVersion) throw new ConflictException('提醒设置已更新，请刷新后重试');
      const preference = existing
        ? await tx.notificationPreference.update({ where: { membershipId_eventType: { membershipId: member.id, eventType: dto.eventType } }, data: { enabled: dto.enabled, leadMinutes: dto.leadMinutes, quietStart: dto.quietStart, quietEnd: dto.quietEnd, version: { increment: 1 } } })
        : await tx.notificationPreference.create({ data: { membershipId: member.id, eventType: dto.eventType, enabled: dto.enabled, leadMinutes: dto.leadMinutes, quietStart: dto.quietStart, quietEnd: dto.quietEnd } });
      return { data: preference };
    });
  }

  async publicSettings(userId: string, householdId: string) {
    await this.access.require(userId, householdId, 'notifications');
    const templateId = this.config.get<string>('WECHAT_TASK_REMINDER_TEMPLATE_ID') || '';
    return { data: { taskReminderTemplateId: templateId || null, wechatSubscriptionAvailable: Boolean(templateId) } };
  }

  async recordReceipt(userId: string, householdId: string, dto: RecordSubscriptionReceiptDto) {
    await this.access.require(userId, householdId, 'notifications');
    const configured = this.config.get<string>('WECHAT_TASK_REMINDER_TEMPLATE_ID') || '';
    if (!configured || dto.templateId !== configured) throw new BadRequestException('微信订阅模板未配置或不匹配');
    return { data: await this.prisma.subscriptionReceipt.create({ data: { userId, templateId: dto.templateId, result: dto.result, clientScene: dto.clientScene?.trim() || null } }) };
  }

  async runDue(now = new Date()) {
    await this.prisma.notificationJob.updateMany({ where: { status: 'PROCESSING', lockedAt: { lt: new Date(now.getTime() - 5 * 60_000) } }, data: { status: 'PENDING', lockedAt: null } });
    const due = await this.prisma.notificationJob.findMany({ where: { status: 'PENDING', scheduledAt: { lte: now } }, orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }], take: 20, select: { id: true } });
    let processed = 0;
    for (const row of due) {
      const claimed = await this.prisma.notificationJob.updateMany({ where: { id: row.id, status: 'PENDING' }, data: { status: 'PROCESSING', lockedAt: now } });
      if (!claimed.count) continue;
      try { await this.processClaimed(row.id, now); processed++; }
      catch (error) { await this.retryOrFail(row.id, now, error); }
    }
    return processed;
  }

  private async processClaimed(jobId: string, now: Date) {
    const job = await this.prisma.notificationJob.findUnique({ where: { id: jobId }, include: { outbox: true, recipient: { include: { user: true } } } });
    if (!job || job.status !== 'PROCESSING') return;
    if (job.channel !== 'INBOX' || job.sourceType !== 'TASK' || job.recipient.status !== 'ACTIVE') { await this.cancelJob(jobId); return; }
    const task = await this.prisma.task.findFirst({ where: { id: job.sourceId, householdId: job.outbox.householdId, archivedAt: null } });
    if (!task || task.version !== job.scheduleVersion || task.assigneeMembershipId !== job.recipientMembershipId || !['PENDING', 'IN_PROGRESS'].includes(task.status)) { await this.cancelJob(jobId); return; }
    try { await this.access.require(job.recipient.userId, job.outbox.householdId, 'tasks'); } catch { await this.cancelJob(jobId); return; }
    const preference = await this.prisma.notificationPreference.findUnique({ where: { membershipId_eventType: { membershipId: job.recipientMembershipId, eventType: job.eventType } } });
    if (preference && !preference.enabled) { await this.cancelJob(jobId); return; }
    const quietEnd = this.quietEnd(now, preference?.quietStart ?? defaultPreference.quietStart, preference?.quietEnd ?? defaultPreference.quietEnd);
    if (quietEnd) { await this.prisma.notificationJob.update({ where: { id: jobId }, data: { status: 'PENDING', scheduledAt: quietEnd, lockedAt: null } }); return; }
    await serializable(this.prisma, async tx => {
      const current = await tx.notificationJob.findUnique({ where: { id: jobId } });
      if (!current || current.status !== 'PROCESSING') return;
      await tx.inboxItem.upsert({ where: { jobId }, update: {}, create: { jobId, recipientMembershipId: job.recipientMembershipId, sourceType: job.sourceType, sourceId: job.sourceId, titleRedacted: '家庭待办提醒' } });
      await tx.notificationJob.update({ where: { id: jobId }, data: { status: 'SENT', attempts: { increment: 1 }, sentAt: now, lockedAt: null, lastError: null } });
    });
  }

  private quietEnd(now: Date, start: string | null, end: string | null) {
    if (!start || !end || start === end) return null;
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
    const read = (type: string) => Number(parts.find(part => part.type === type)?.value), year = read('year'), month = read('month'), day = read('day'), minute = read('hour') * 60 + read('minute');
    const parse = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3)), begin = parse(start), finish = parse(end);
    let inQuiet = false, addDay = 0;
    if (begin < finish) inQuiet = minute >= begin && minute < finish;
    else if (minute >= begin) { inQuiet = true; addDay = 1; } else if (minute < finish) inQuiet = true;
    if (!inQuiet) return null;
    return new Date(Date.UTC(year, month - 1, day + addDay, Math.floor(finish / 60) - 8, finish % 60));
  }

  private async retryOrFail(jobId: string, now: Date, error: unknown) {
    const job = await this.prisma.notificationJob.findUnique({ where: { id: jobId }, select: { attempts: true, status: true } });
    if (!job || job.status !== 'PROCESSING') return;
    const attempts = job.attempts + 1, delays = [1, 5, 15], failed = attempts > 3;
    await this.prisma.notificationJob.update({ where: { id: jobId }, data: { status: failed ? 'FAILED' : 'PENDING', attempts, scheduledAt: failed ? undefined : new Date(now.getTime() + delays[attempts - 1] * 60_000), lockedAt: null, lastError: error instanceof Error ? error.name.slice(0, 120) : 'UNKNOWN' } });
  }

  private async cancelJob(jobId: string) { await this.prisma.notificationJob.updateMany({ where: { id: jobId, status: 'PROCESSING' }, data: { status: 'CANCELLED', lockedAt: null } }); }
  private async invalidate(itemId: string) { await this.prisma.inboxItem.updateMany({ where: { id: itemId, invalidatedAt: null }, data: { invalidatedAt: new Date(), version: { increment: 1 } } }); }
}
