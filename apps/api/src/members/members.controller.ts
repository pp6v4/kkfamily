import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';
import { CreateInvitationDto, PermissionsDto, RedeemInvitationDto, StatusDto, TransferAdminDto, VersionDto } from './members.dto';
import { MembersService } from './members.service';

@Controller()
@UseGuards(AccessTokenGuard)
export class MembersController {
  constructor(private readonly members: MembersService) {}
  @Get('households/current/access')
  current(@CurrentUser() user: RequestUser, @Headers('x-household-id') h: string) { return this.members.current(user.userId, h); }
  @Get('members/roles')
  roles(@CurrentUser() user: RequestUser, @Headers('x-household-id') h: string) { return this.members.catalog(user.userId, h); }
  @Get('members')
  list(@CurrentUser() user: RequestUser, @Headers('x-household-id') h: string, @Query('cursor') cursor?: string) { return this.members.list(user.userId, h, cursor); }
  @Get('households/:id/invitations')
  invitations(@CurrentUser() user: RequestUser, @Headers('x-household-id') h: string, @Param('id') id: string) { this.sameHousehold(h, id); return this.members.invitations(user.userId, h); }
  @Post('households/:id/invitations')
  createInvitation(@CurrentUser() user: RequestUser, @Headers('x-household-id') h: string, @Param('id') id: string, @Body() dto: CreateInvitationDto) { this.sameHousehold(h, id); return this.members.createInvitation(user.userId, h, dto); }
  @Post('invitations/redeem')
  redeem(@CurrentUser() user: RequestUser, @Body() dto: RedeemInvitationDto) { return this.members.redeem(user.userId, dto.code); }
  @Delete('invitations/:id')
  revoke(@CurrentUser() user: RequestUser, @Headers('x-household-id') h: string, @Param('id') id: string, @Body() dto: VersionDto) { return this.members.revokeInvitation(user.userId, h, id, dto.version); }
  @Patch('members/:id/permissions')
  permissions(@CurrentUser() user: RequestUser, @Headers('x-household-id') h: string, @Param('id') id: string, @Body() dto: PermissionsDto) { return this.members.changePermissions(user.userId, h, id, dto); }
  @Patch('members/:id/status')
  status(@CurrentUser() user: RequestUser, @Headers('x-household-id') h: string, @Param('id') id: string, @Body() dto: StatusDto) { return this.members.changeStatus(user.userId, h, id, dto); }
  @Post('households/:id/transfer-admin')
  transfer(@CurrentUser() user: RequestUser, @Headers('x-household-id') h: string, @Param('id') id: string, @Body() dto: TransferAdminDto) { this.sameHousehold(h, id); return this.members.transfer(user.userId, h, dto); }
  private sameHousehold(header: string, id: string) { if (header !== id) throw new BadRequestException('家庭路径与请求头不一致'); }
}
