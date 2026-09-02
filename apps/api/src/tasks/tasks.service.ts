import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TaskStatus } from '@prisma/client';
import { AccessService } from '../access/access.service';
import { permits } from '../access/permission-policy';
import { PrismaService } from '../prisma/prisma.service';
import { serializable } from '../prisma/serializable';
import { CreateTaskCommentDto, CreateTaskDto, ListTasksDto, UpdateTaskDto, UpdateTaskStatusDto } from './tasks.dto';

const userSelect={id:true,nickname:true,avatarUrl:true} as const;
const taskInclude={assignee:{include:{user:{select:userSelect}}},createdBy:{include:{user:{select:userSelect}}},completedBy:{include:{user:{select:userSelect}}}} as const;
const detailInclude={...taskInclude,history:{include:{actor:{include:{user:{select:userSelect}}}},orderBy:[{createdAt:'asc'},{id:'asc'}]}} as const;

@Injectable()
export class TasksService {
  constructor(private readonly prisma:PrismaService,private readonly access:AccessService){}

  async list(userId:string,householdId:string,query:ListTasksDto){await this.access.require(userId,householdId,'tasks');return{data:await this.prisma.task.findMany({where:{householdId,archivedAt:null,...(query.status?{status:query.status}:{})},include:taskInclude,orderBy:[{status:'asc'},{dueAt:'asc'},{createdAt:'desc'}]})};}
  async detail(userId:string,householdId:string,taskId:string){await this.access.require(userId,householdId,'tasks');return{data:await this.taskOrThrow(this.prisma,householdId,taskId,true)};}
  async assignees(userId:string,householdId:string){await this.access.require(userId,householdId,'tasks','EDIT');return{data:await this.prisma.membership.findMany({where:{householdId,status:'ACTIVE'},select:{id:true,user:{select:userSelect}},orderBy:{createdAt:'asc'}})};}

  async create(userId:string,householdId:string,dto:CreateTaskDto){return{data:await serializable(this.prisma,async tx=>{
    const member=await this.access.require(userId,householdId,'tasks','EDIT',tx);const assigneeId=dto.assigneeMembershipId||member.id;
    if(assigneeId!==member.id&&!permits(member.effectivePermissions,'tasks','MANAGE'))throw new ForbiddenException('只有待办管理员可以分配给其他成员');
    await this.requireAssignee(tx,householdId,assigneeId);const dates=this.dates(dto.dueAt,dto.reminderAt);
    const task=await tx.task.create({data:{householdId,type:dto.type,title:dto.title.trim(),description:dto.description?.trim()||null,assigneeMembershipId:assigneeId,dueAt:dates.dueAt,priority:dto.priority,reminderAt:dates.reminderAt,createdById:member.id}});
    await tx.taskHistory.create({data:{taskId:task.id,actorMembershipId:member.id,toStatus:TaskStatus.PENDING,comment:'创建待办'}});
    await this.audit(tx,householdId,member.id,'TASK_CREATE',task.id,{type:task.type,assigneeMembershipId:assigneeId});return this.taskOrThrow(tx,householdId,task.id,true);
  })};}

  async update(userId:string,householdId:string,taskId:string,dto:UpdateTaskDto){return{data:await serializable(this.prisma,async tx=>{
    const member=await this.access.require(userId,householdId,'tasks','EDIT',tx),task=await this.taskOrThrow(tx,householdId,taskId);
    if(task.version!==dto.expectedVersion)throw new ConflictException('待办已更新，请刷新后重试');const manage=permits(member.effectivePermissions,'tasks','MANAGE');
    if(!manage&&task.assigneeMembershipId!==member.id&&!(task.createdById===member.id&&task.status===TaskStatus.PENDING))throw new ForbiddenException('只有负责人、未开始待办的创建者或管理员可以修改');
    const assigneeId=dto.assigneeMembershipId===undefined?task.assigneeMembershipId:dto.assigneeMembershipId?.trim()||null;
    if(assigneeId!==task.assigneeMembershipId&&!manage)throw new ForbiddenException('只有待办管理员可以重新分配负责人');if(assigneeId)await this.requireAssignee(tx,householdId,assigneeId);
    const dates=this.dates(dto.dueAt===undefined?task.dueAt?.toISOString():dto.dueAt??undefined,dto.reminderAt===undefined?task.reminderAt?.toISOString():dto.reminderAt??undefined);
    const changed=await tx.task.updateMany({where:{id:taskId,householdId,archivedAt:null,version:dto.expectedVersion},data:{type:dto.type,title:dto.title?.trim(),description:dto.description===undefined?undefined:dto.description.trim()||null,assigneeMembershipId:assigneeId,dueAt:dates.dueAt,priority:dto.priority,reminderAt:dates.reminderAt,version:{increment:1}}});if(!changed.count)throw new ConflictException('待办已更新，请刷新后重试');
    await tx.taskHistory.create({data:{taskId,actorMembershipId:member.id,comment:'更新待办内容'}});await this.audit(tx,householdId,member.id,'TASK_UPDATE',taskId,{fromVersion:task.version,toVersion:task.version+1});return this.taskOrThrow(tx,householdId,taskId,true);
  })};}

  async changeStatus(userId:string,householdId:string,taskId:string,dto:UpdateTaskStatusDto){return{data:await serializable(this.prisma,async tx=>{
    const member=await this.access.require(userId,householdId,'tasks','EDIT',tx),task=await this.taskOrThrow(tx,householdId,taskId);if(task.version!==dto.expectedVersion)throw new ConflictException('待办已更新，请刷新后重试');
    if(task.assigneeMembershipId!==member.id&&!permits(member.effectivePermissions,'tasks','MANAGE'))throw new ForbiddenException('只有负责人或待办管理员可以更新状态');
    if(task.status===dto.status)return this.taskOrThrow(tx,householdId,taskId,true);this.assertTransition(task.status,dto.status,dto.reason);
    const completed=dto.status===TaskStatus.COMPLETED;
    const changed=await tx.task.updateMany({where:{id:taskId,householdId,archivedAt:null,version:dto.expectedVersion},data:{status:dto.status,completedAt:completed?new Date():null,completedById:completed?member.id:null,version:{increment:1}}});if(!changed.count)throw new ConflictException('待办已更新，请刷新后重试');
    await tx.taskHistory.create({data:{taskId,actorMembershipId:member.id,fromStatus:task.status,toStatus:dto.status,comment:dto.reason?.trim()||null}});await this.audit(tx,householdId,member.id,'TASK_STATUS',taskId,{from:task.status,to:dto.status});return this.taskOrThrow(tx,householdId,taskId,true);
  })};}

  async comment(userId:string,householdId:string,taskId:string,dto:CreateTaskCommentDto){const member=await this.access.require(userId,householdId,'tasks','EDIT'),task=await this.taskOrThrow(this.prisma,householdId,taskId);if(task.assigneeMembershipId!==member.id&&task.createdById!==member.id&&!permits(member.effectivePermissions,'tasks','MANAGE'))throw new ForbiddenException('只有创建者、负责人或管理员可以添加处理记录');await this.prisma.taskHistory.create({data:{taskId,actorMembershipId:member.id,comment:dto.comment.trim()}});return this.detail(userId,householdId,taskId);}

  private async taskOrThrow(tx:Prisma.TransactionClient|PrismaService,householdId:string,taskId:string,detail=false){const task=await tx.task.findFirst({where:{id:taskId,householdId,archivedAt:null},include:detail?detailInclude:taskInclude});if(!task)throw new NotFoundException('待办不存在');return task;}
  private async requireAssignee(tx:Prisma.TransactionClient,householdId:string,membershipId:string){const member=await tx.membership.findFirst({where:{id:membershipId,householdId,status:'ACTIVE'}});if(!member)throw new BadRequestException('负责人必须是当前家庭的有效成员');return member;}
  private dates(dueInput?:string,reminderInput?:string){const dueAt=dueInput?new Date(dueInput):null,reminderAt=reminderInput?new Date(reminderInput):null;if((dueAt&&Number.isNaN(dueAt.valueOf()))||(reminderAt&&Number.isNaN(reminderAt.valueOf()))||(dueAt&&reminderAt&&reminderAt>dueAt))throw new BadRequestException('截止时间或提醒时间无效，提醒不能晚于截止时间');return{dueAt,reminderAt};}
  private assertTransition(from:TaskStatus,to:TaskStatus,reason?:string){const allowed:Record<TaskStatus,TaskStatus[]>={PENDING:[TaskStatus.IN_PROGRESS,TaskStatus.COMPLETED,TaskStatus.CANCELLED],IN_PROGRESS:[TaskStatus.COMPLETED,TaskStatus.CANCELLED],COMPLETED:[TaskStatus.PENDING],CANCELLED:[TaskStatus.PENDING]};if(!allowed[from].includes(to))throw new ConflictException(`不能从 ${from} 更新为 ${to}`);if((from===TaskStatus.COMPLETED||from===TaskStatus.CANCELLED)&&!reason?.trim())throw new BadRequestException('重新打开待办必须填写原因');}
  private async audit(tx:Prisma.TransactionClient,householdId:string,actorMembershipId:string,action:string,targetId:string,details:Prisma.InputJsonValue){await tx.auditLog.create({data:{householdId,actorMembershipId,action,targetId,details}});}
}
