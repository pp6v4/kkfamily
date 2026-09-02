import { TaskPriority, TaskStatus, TaskType } from '@prisma/client';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { TrimText } from '../common/trim-text';

export class ListTasksDto {
  @IsOptional() @IsEnum(TaskStatus)
  status?: TaskStatus;
}

export class CreateTaskDto {
  @IsEnum(TaskType)
  type!: TaskType;
  @TrimText() @IsString() @Length(1, 120)
  title!: string;
  @IsOptional() @TrimText() @IsString() @Length(0, 2000)
  description?: string;
  @IsOptional() @TrimText() @IsString() @Length(1, 80)
  assigneeMembershipId?: string;
  @IsOptional() @IsDateString()
  dueAt?: string;
  @IsEnum(TaskPriority)
  priority!: TaskPriority;
  @IsOptional() @IsDateString()
  reminderAt?: string;
}

export class UpdateTaskDto {
  @IsInt() @Min(1)
  expectedVersion!: number;
  @IsOptional() @IsEnum(TaskType)
  type?: TaskType;
  @IsOptional() @TrimText() @IsString() @Length(1, 120)
  title?: string;
  @IsOptional() @TrimText() @IsString() @Length(0, 2000)
  description?: string;
  @IsOptional() @TrimText() @IsString() @Length(0, 80)
  assigneeMembershipId?: string | null;
  @IsOptional() @IsDateString()
  dueAt?: string | null;
  @IsOptional() @IsEnum(TaskPriority)
  priority?: TaskPriority;
  @IsOptional() @IsDateString()
  reminderAt?: string | null;
}

export class UpdateTaskStatusDto {
  @IsInt() @Min(1)
  expectedVersion!: number;
  @IsEnum(TaskStatus)
  status!: TaskStatus;
  @IsOptional() @TrimText() @IsString() @Length(1, 500)
  reason?: string;
}

export class CreateTaskCommentDto {
  @TrimText() @IsString() @Length(1, 1000)
  comment!: string;
}
