import { BadRequestException, ConflictException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { MediaOwnerType, Prisma, RecipeStatus, TripMemberStatus } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { AccessService } from '../access/access.service';
import { permits, Permissions } from '../access/permission-policy';
import { PrismaService } from '../prisma/prisma.service';
import { serializable } from '../prisma/serializable';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';
import { CreateUploadIntentDto } from './dto/create-upload-intent.dto';
import { validateImageBytes } from './image-validation';
import { ObjectStorageService } from './object-storage.service';

const extensions: Record<string,string> = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};

@Injectable()
export class MediaService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly storage: ObjectStorageService, private readonly jwt: JwtService) {}

  async createIntent(userId: string, householdId: string, dto: CreateUploadIntentDto) {
    this.storage.assertAvailable();
    if (dto.ownerType!==MediaOwnerType.RECIPE&&dto.ownerType!==MediaOwnerType.TRIP&&dto.ownerType!==MediaOwnerType.FAVORITE) throw new BadRequestException('当前版本只开放菜谱、行程和收藏图片');
    const owner=await this.requireOwnerWrite(this.prisma,userId,householdId,dto.ownerType,dto.ownerId,dto.expectedOwnerVersion);
    const folder=dto.ownerType===MediaOwnerType.RECIPE?'recipes':dto.ownerType===MediaOwnerType.TRIP?'trips':'favorites';
    const objectKey=`households/${householdId}/${folder}/${dto.ownerId}/${randomUUID()}.${extensions[dto.mimeType]}`;
    const intent=await this.prisma.uploadIntent.create({data:{householdId,requestedById:owner.memberId,ownerType:dto.ownerType,ownerId:dto.ownerId,expectedOwnerVersion:owner.version,objectKey,mimeType:dto.mimeType,declaredBytes:dto.byteSize,expiresAt:new Date(Date.now()+10*60*1000)}});
    return {data:{id:intent.id,uploadPath:`/media/upload-intents/${intent.id}/content`,mimeType:intent.mimeType,byteSize:intent.declaredBytes,expiresAt:intent.expiresAt}};
  }

  async upload(userId:string,householdId:string,intentId:string,contentTypeHeader:string|undefined,body:unknown){
    const intent=await this.intentFor(userId,householdId,intentId);
    await this.notExpired(intent);
    const contentType=(contentTypeHeader??'').split(';')[0].trim().toLowerCase();
    if(contentType!==intent.mimeType)throw new BadRequestException('上传Content-Type与申请不一致');
    const bytes=validateImageBytes(body,intent.mimeType,intent.declaredBytes);
    const checksumSha256=createHash('sha256').update(bytes).digest('hex');
    if(['UPLOADED','CONFIRMED'].includes(intent.status)){
      if(intent.checksumSha256===checksumSha256&&intent.uploadedBytes===bytes.length)return{data:{intentId,checksumSha256,byteSize:bytes.length}};
      throw new ConflictException('该上传申请已经写入其他内容');
    }
    if(intent.status!=='PENDING')throw new ConflictException('上传申请状态不可写入');
    await this.storage.put(intent.objectKey,bytes,intent.mimeType,checksumSha256);
    const changed=await this.prisma.uploadIntent.updateMany({where:{id:intent.id,status:'PENDING'},data:{status:'UPLOADED',uploadedBytes:bytes.length,checksumSha256}});
    if(changed.count!==1){const current=await this.prisma.uploadIntent.findUnique({where:{id:intent.id}});if(current?.checksumSha256!==checksumSha256)throw new ConflictException('该上传申请已被其他请求占用');}
    return{data:{intentId,checksumSha256,byteSize:bytes.length}};
  }

  async confirm(userId:string,householdId:string,dto:ConfirmUploadDto){
    const intent=await this.intentFor(userId,householdId,dto.intentId);await this.notExpired(intent);
    if(intent.status==='CONFIRMED'){const asset=await this.prisma.mediaAsset.findUnique({where:{intentId:intent.id}});if(!asset)throw new ConflictException('图片确认记录不完整');return{data:{asset,ownerVersion:await this.ownerVersion(this.prisma,intent.ownerType,intent.ownerId)}};}
    if(intent.status!=='UPLOADED'||intent.checksumSha256!==dto.checksumSha256)throw new ConflictException('图片尚未上传完成或校验值不匹配');
    const head=await this.storage.head(intent.objectKey);
    if(head.bytes!==intent.declaredBytes||head.mimeType!==intent.mimeType||head.checksumSha256!==dto.checksumSha256)throw new ConflictException('对象存储中的图片校验失败');
    return serializable(this.prisma,async tx=>{
      const current=await tx.uploadIntent.findFirst({where:{id:intent.id,householdId}});if(!current)throw new NotFoundException('上传申请不存在');
      const owner=await this.requireOwnerWrite(tx,userId,householdId,current.ownerType,current.ownerId,current.expectedOwnerVersion);
      if(!this.canUseIntent(current.ownerType,current.requestedById,owner.memberId,owner.effectivePermissions))throw new NotFoundException('上传申请不存在');
      if(current.status==='CONFIRMED'){const asset=await tx.mediaAsset.findUniqueOrThrow({where:{intentId:current.id}});return{data:{asset,ownerVersion:await this.ownerVersion(tx,current.ownerType,current.ownerId)}};}
      if(current.status!=='UPLOADED'||current.checksumSha256!==dto.checksumSha256)throw new ConflictException('上传状态已经变化');
      const asset=await tx.mediaAsset.create({data:{householdId,intentId:current.id,objectKey:current.objectKey,mimeType:current.mimeType,byteSize:current.uploadedBytes!,checksumSha256:current.checksumSha256,createdById:owner.memberId}});
      await tx.mediaReference.create({data:{householdId,assetId:asset.id,ownerType:current.ownerType,ownerId:current.ownerId}});
      if(current.ownerType===MediaOwnerType.RECIPE)await tx.recipe.update({where:{id:current.ownerId},data:{coverAssetId:asset.id,version:{increment:1}}});
      else if(current.ownerType===MediaOwnerType.TRIP)await tx.trip.update({where:{id:current.ownerId},data:{version:{increment:1}}});
      else {
        const favorite=await tx.favorite.findUniqueOrThrow({where:{id:current.ownerId},select:{assetIds:true}});
        const assetIds=Array.isArray(favorite.assetIds)?favorite.assetIds.filter((id):id is string=>typeof id==='string'):[];
        await tx.favorite.update({where:{id:current.ownerId},data:{assetIds:[...assetIds,asset.id],version:{increment:1}}});
      }
      await tx.uploadIntent.update({where:{id:current.id},data:{status:'CONFIRMED'}});
      const action=current.ownerType===MediaOwnerType.RECIPE?'RECIPE_COVER_CONFIRM':current.ownerType===MediaOwnerType.TRIP?'TRIP_PHOTO_CONFIRM':'FAVORITE_IMAGE_CONFIRM';
      await tx.auditLog.create({data:{householdId,actorMembershipId:owner.memberId,action,targetId:current.ownerId,details:{assetId:asset.id,fromVersion:owner.version,toVersion:owner.version+1}}});
      return{data:{asset,ownerVersion:owner.version+1}};
    });
  }

  async listTripPhotos(userId:string,householdId:string,tripId:string){
    await this.requireTripRead(this.prisma,userId,householdId,tripId);
    const references=await this.prisma.mediaReference.findMany({where:{householdId,ownerType:MediaOwnerType.TRIP,ownerId:tripId,asset:{status:'READY'}},include:{asset:{include:{createdBy:{include:{user:{select:{id:true,nickname:true,avatarUrl:true}}}}}}},orderBy:{createdAt:'desc'}});
    return{data:references.map(reference=>({id:reference.asset.id,mimeType:reference.asset.mimeType,byteSize:reference.asset.byteSize,createdAt:reference.asset.createdAt,createdBy:reference.asset.createdBy.user}))};
  }

  async issueReadUrl(userId:string,householdId:string,assetId:string){
    const asset=await this.prisma.mediaAsset.findFirst({where:{id:assetId,householdId,status:'READY'},include:{references:true}});if(!asset)throw new NotFoundException('图片不存在');
    let allowed=false;
    for(const reference of asset.references){
      if(reference.ownerType===MediaOwnerType.RECIPE){const recipe=await this.prisma.recipe.findFirst({where:{id:reference.ownerId,householdId}});if(!recipe)continue;const member=await this.access.require(userId,householdId,'recipes',recipe.status===RecipeStatus.PUBLISHED?'VIEW':'EDIT');if(permits(member.effectivePermissions,'recipes',recipe.status===RecipeStatus.PUBLISHED?'VIEW':'EDIT')){allowed=true;break;}}
      if(reference.ownerType===MediaOwnerType.TRIP){const tripMember=await this.requireTripRead(this.prisma,userId,householdId,reference.ownerId);if(tripMember){allowed=true;break;}}
      if(reference.ownerType===MediaOwnerType.FAVORITE){const member=await this.access.require(userId,householdId,'favorites','VIEW');const manage=permits(member.effectivePermissions,'favorites','MANAGE');const favorite=await this.prisma.favorite.findFirst({where:{id:reference.ownerId,householdId,archivedAt:null,...(manage?{}:{OR:[{visibility:'HOUSEHOLD' as const},{createdById:member.id}]})}});if(favorite){allowed=true;break;}}
    }
    if(!allowed)throw new NotFoundException('图片不存在');
    const token=await this.jwt.signAsync({typ:'media',assetId:asset.id,householdId},{expiresIn:60,audience:'media'});
    return{data:{path:`/media/public?token=${encodeURIComponent(token)}`,expiresAt:new Date(Date.now()+60_000).toISOString()}};
  }

  async readPublic(token:string){
    let payload:{typ?:string;assetId?:string;householdId?:string};try{payload=await this.jwt.verifyAsync(token,{audience:'media'});}catch{throw new NotFoundException('图片链接无效或已过期');}
    if(payload.typ!=='media'||!payload.assetId||!payload.householdId)throw new NotFoundException('图片链接无效');
    const asset=await this.prisma.mediaAsset.findFirst({where:{id:payload.assetId,householdId:payload.householdId,status:'READY'}});if(!asset)throw new NotFoundException('图片不存在');
    return this.storage.get(asset.objectKey);
  }

  private async intentFor(userId:string,householdId:string,intentId:string){const intent=await this.prisma.uploadIntent.findFirst({where:{id:intentId,householdId}});if(!intent)throw new NotFoundException('上传申请不存在');if(intent.ownerType!==MediaOwnerType.RECIPE&&intent.ownerType!==MediaOwnerType.TRIP&&intent.ownerType!==MediaOwnerType.FAVORITE)throw new BadRequestException('不支持的图片归属');const owner=await this.requireOwnerWrite(this.prisma,userId,householdId,intent.ownerType,intent.ownerId);if(!this.canUseIntent(intent.ownerType,intent.requestedById,owner.memberId,owner.effectivePermissions))throw new NotFoundException('上传申请不存在');return intent;}
  private async requireOwnerWrite(tx:Prisma.TransactionClient|PrismaService,userId:string,householdId:string,ownerType:MediaOwnerType,ownerId:string,expectedVersion?:number){
    if(ownerType===MediaOwnerType.RECIPE){const member=await this.access.require(userId,householdId,'recipes','EDIT',tx);const recipe=await tx.recipe.findFirst({where:{id:ownerId,householdId}});if(!recipe)throw new NotFoundException('菜谱不存在');if(expectedVersion!==undefined&&recipe.version!==expectedVersion)throw new ConflictException('图片所属内容已被其他人修改，请刷新后重试');return{memberId:member.id,effectivePermissions:member.effectivePermissions,version:recipe.version};}
    if(ownerType===MediaOwnerType.TRIP){const member=await this.access.require(userId,householdId,'trips','EDIT',tx);const tripMember=await tx.tripMember.findFirst({where:{tripId:ownerId,membershipId:member.id,status:{in:[TripMemberStatus.ACTIVE,TripMemberStatus.HISTORY]},canEdit:true,trip:{householdId}},include:{trip:true}});if(!tripMember)throw new NotFoundException('行程不存在或当前成员不能添加照片');if(expectedVersion!==undefined&&tripMember.trip.version!==expectedVersion)throw new ConflictException('行程已更新，请刷新后重试');return{memberId:member.id,effectivePermissions:member.effectivePermissions,version:tripMember.trip.version};}
    if(ownerType===MediaOwnerType.FAVORITE){const member=await this.access.require(userId,householdId,'favorites','EDIT',tx);const favorite=await tx.favorite.findFirst({where:{id:ownerId,householdId,archivedAt:null}});if(!favorite)throw new NotFoundException('收藏不存在');if(favorite.createdById!==member.id&&!permits(member.effectivePermissions,'favorites','MANAGE'))throw new NotFoundException('收藏不存在或当前成员不能添加图片');if(expectedVersion!==undefined&&favorite.version!==expectedVersion)throw new ConflictException('收藏已更新，请刷新后重试');return{memberId:member.id,effectivePermissions:member.effectivePermissions,version:favorite.version};}
    throw new BadRequestException('不支持的图片归属');
  }
  private async requireTripRead(tx:Prisma.TransactionClient|PrismaService,userId:string,householdId:string,tripId:string){const member=await this.access.require(userId,householdId,'trips','VIEW',tx);const tripMember=await tx.tripMember.findFirst({where:{tripId,membershipId:member.id,status:{in:[TripMemberStatus.ACTIVE,TripMemberStatus.HISTORY]},trip:{householdId}}});if(!tripMember)throw new NotFoundException('行程不存在');return tripMember;}
  private async ownerVersion(tx:Prisma.TransactionClient|PrismaService,ownerType:MediaOwnerType,ownerId:string){if(ownerType===MediaOwnerType.RECIPE)return(await tx.recipe.findUnique({where:{id:ownerId},select:{version:true}}))?.version;if(ownerType===MediaOwnerType.TRIP)return(await tx.trip.findUnique({where:{id:ownerId},select:{version:true}}))?.version;if(ownerType===MediaOwnerType.FAVORITE)return(await tx.favorite.findUnique({where:{id:ownerId},select:{version:true}}))?.version;return undefined;}
  private canUseIntent(ownerType:MediaOwnerType,requestedById:string,memberId:string,effectivePermissions:Permissions){return requestedById===memberId||(ownerType===MediaOwnerType.RECIPE&&permits(effectivePermissions,'recipes','MANAGE'))||(ownerType===MediaOwnerType.FAVORITE&&permits(effectivePermissions,'favorites','MANAGE'));}
  private async notExpired(intent:{id:string;expiresAt:Date;status:string}){if(intent.expiresAt.getTime()<=Date.now()&&intent.status!=='CONFIRMED'){await this.prisma.uploadIntent.updateMany({where:{id:intent.id,status:{in:['PENDING','UPLOADED']}},data:{status:'EXPIRED'}});throw new GoneException('上传申请已过期');}}
}
