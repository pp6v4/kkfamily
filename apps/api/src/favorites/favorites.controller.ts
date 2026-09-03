import { Body, Controller, Get, Headers, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser, RequestUser } from '../auth/current-user.decorator';
import { ArchiveFavoriteDto, ConvertFavoriteDto, CreateFavoriteDto, UpdateFavoriteDto } from './favorites.dto';
import { FavoritesService } from './favorites.service';

@Controller('favorites')
@UseGuards(AccessTokenGuard)
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string) {
    return this.favorites.list(user.userId, householdId);
  }

  @Get(':favoriteId')
  detail(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('favoriteId') favoriteId: string) {
    return this.favorites.detail(user.userId, householdId, favoriteId);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Body() dto: CreateFavoriteDto) {
    return this.favorites.create(user.userId, householdId, dto);
  }

  @Patch(':favoriteId')
  update(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('favoriteId') favoriteId: string, @Body() dto: UpdateFavoriteDto) {
    return this.favorites.update(user.userId, householdId, favoriteId, dto);
  }

  @Post(':favoriteId/archive')
  archive(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('favoriteId') favoriteId: string, @Body() dto: ArchiveFavoriteDto) {
    return this.favorites.archive(user.userId, householdId, favoriteId, dto);
  }

  @Post(':favoriteId/convert')
  convert(@CurrentUser() user: RequestUser, @Headers('x-household-id') householdId: string, @Param('favoriteId') favoriteId: string, @Body() dto: ConvertFavoriteDto) {
    return this.favorites.convert(user.userId, householdId, favoriteId, dto);
  }
}
