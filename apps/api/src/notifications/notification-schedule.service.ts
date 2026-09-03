import { Injectable } from '@nestjs/common';
import { NotificationChannel, NotificationEventType, Prisma, TaskStatus } from '@prisma/client';

type SchedulableTask = { id:string;householdId:string;version:number;assigneeMembershipId:string|null;reminderAt:Date|null;status:TaskStatus;archivedAt:Date|null };

@Injectable()
export class NotificationScheduleService {
  async syncTask(tx: Prisma.TransactionClient, task: SchedulableTask) {
    const now = new Date();
    await tx.notificationJob.updateMany({ where: { sourceType: 'TASK', sourceId: task.id, status: { in: ['PENDING', 'PROCESSING'] } }, data: { status: 'CANCELLED', lockedAt: null } });
    await tx.inboxItem.updateMany({ where: { sourceType: 'TASK', sourceId: task.id, invalidatedAt: null }, data: { invalidatedAt: now, version: { increment: 1 } } });
    const schedulable = Boolean(task.assigneeMembershipId && task.reminderAt && !task.archivedAt && (task.status===TaskStatus.PENDING||task.status===TaskStatus.IN_PROGRESS));
    const outbox = await tx.outboxEvent.create({ data: { householdId: task.householdId, eventType: NotificationEventType.TASK_REMINDER, aggregateType: 'TASK', aggregateId: task.id, version: task.version, payloadRedacted: { state: schedulable ? 'SCHEDULED' : 'CANCELLED' }, status: 'PROCESSED', processedAt: now } });
    if (schedulable) await tx.notificationJob.create({ data: { outboxId: outbox.id, recipientMembershipId: task.assigneeMembershipId!, eventType: NotificationEventType.TASK_REMINDER, sourceType: 'TASK', sourceId: task.id, scheduleVersion: task.version, channel: NotificationChannel.INBOX, scheduledAt: task.reminderAt!, dedupeKey: `${task.assigneeMembershipId}:TASK_REMINDER:${task.id}:${task.version}:INBOX` } });
  }
}
