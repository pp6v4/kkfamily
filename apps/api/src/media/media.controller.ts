import { Body, Controller, Get, Headers, Param, Post, Put, Res, UseGuards } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';
import { CreateUploadIntentDto } from './dto/create-upload-intent.dto';
import { MediaService } from './media.service';

@Controller('media')
export class MediaController {
  constructor(private readonly media:MediaService){}

  @Post('upload-intents') @UseGuards(AccessTokenGuard)
  createIntent(@CurrentUser() user:RequestUser,@Headers('x-household-id') householdId:string,@Body() dto:CreateUploadIntentDto){return this.media.createIntent(user.userId,householdId,dto);}

  @Put('upload-intents/:id/content') @UseGuards(AccessTokenGuard)
  upload(@CurrentUser() user:RequestUser,@Headers('x-household-id') householdId:string,@Headers('content-type') contentType:string|undefined,@Param('id') id:string,@Body() body:unknown){return this.media.upload(user.userId,householdId,id,contentType,body);}

  @Post('assets/confirm') @UseGuards(AccessTokenGuard)
  confirm(@CurrentUser() user:RequestUser,@Headers('x-household-id') householdId:string,@Body() dto:ConfirmUploadDto){return this.media.confirm(user.userId,householdId,dto);}

  @Get('assets/:id/url') @UseGuards(AccessTokenGuard)
  readUrl(@CurrentUser() user:RequestUser,@Headers('x-household-id') householdId:string,@Param('id') id:string){return this.media.issueReadUrl(user.userId,householdId,id);}

  @Get('public/:token')
  async publicImage(@Param('token') token:string,@Res() reply:FastifyReply){const file=await this.media.readPublic(token);return reply.header('Cache-Control','private, max-age=60').type(file.mimeType).send(file.body);}
}
