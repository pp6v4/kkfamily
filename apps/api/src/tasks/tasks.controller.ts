import { Body, Controller, Get, Headers, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';
import { CreateTaskCommentDto, CreateTaskDto, ListTasksDto, UpdateTaskDto, UpdateTaskStatusDto } from './tasks.dto';
import { TasksService } from './tasks.service';

@Controller('tasks')
@UseGuards(AccessTokenGuard)
export class TasksController {
  constructor(private readonly tasks:TasksService){}
  @Get() list(@CurrentUser() user:RequestUser,@Headers('x-household-id') householdId:string,@Query() query:ListTasksDto){return this.tasks.list(user.userId,householdId,query);}
  @Get('assignees') assignees(@CurrentUser() user:RequestUser,@Headers('x-household-id') householdId:string){return this.tasks.assignees(user.userId,householdId);}
  @Get(':taskId') detail(@CurrentUser() user:RequestUser,@Headers('x-household-id') householdId:string,@Param('taskId') taskId:string){return this.tasks.detail(user.userId,householdId,taskId);}
  @Post() create(@CurrentUser() user:RequestUser,@Headers('x-household-id') householdId:string,@Body() dto:CreateTaskDto){return this.tasks.create(user.userId,householdId,dto);}
  @Patch(':taskId') update(@CurrentUser() user:RequestUser,@Headers('x-household-id') householdId:string,@Param('taskId') taskId:string,@Body() dto:UpdateTaskDto){return this.tasks.update(user.userId,householdId,taskId,dto);}
  @Patch(':taskId/status') status(@CurrentUser() user:RequestUser,@Headers('x-household-id') householdId:string,@Param('taskId') taskId:string,@Body() dto:UpdateTaskStatusDto){return this.tasks.changeStatus(user.userId,householdId,taskId,dto);}
  @Post(':taskId/comments') comment(@CurrentUser() user:RequestUser,@Headers('x-household-id') householdId:string,@Param('taskId') taskId:string,@Body() dto:CreateTaskCommentDto){return this.tasks.comment(user.userId,householdId,taskId,dto);}
}
