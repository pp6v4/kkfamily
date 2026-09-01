import { BadRequestException, ConflictException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { MediaOwnerType, Prisma, RecipeStatus } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { AccessService } from '../access/access.service';
import { permits } from '../access/permission-policy';
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
    if (dto.ownerType !== MediaOwnerType.RECIPE) throw new BadRequestException('当前版本只开放菜谱图片，行程照片将在行程成员闭环后启用');
    const member=await this.access.require(userId,householdId,'recipes','EDIT');
    const recipe=await this.prisma.recipe.findFirst({where:{id:dto.ownerId,householdId}});
    if(!recipe)throw new NotFoundException('菜谱不存在');
    if(recipe.version!==dto.expectedOwnerVersion)throw new ConflictException('菜谱已被其他人修改，请刷新后重试');
    const objectKey=`households/${householdId}/recipes/${recipe.id}/${randomUUID()}.${extensions[dto.mimeType]}`;
    const intent=await this.prisma.uploadIntent.create({data:{householdId,requestedById:member.id,ownerType:dto.ownerType,ownerId:recipe.id,expectedOwnerVersion:recipe.version,objectKey,mimeType:dto.mimeType,declaredBytes:dto.byteSize,expiresAt:new Date(Date.now()+10*60*1000)}});
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
    if(intent.status==='CONFIRMED'){const asset=await this.prisma.mediaAsset.findUnique({where:{intentId:intent.id}});if(!asset)throw new ConflictException('图片确认记录不完整');const recipe=await this.prisma.recipe.findUnique({where:{id:intent.ownerId}});return{data:{asset,ownerVersion:recipe?.version}};}
    if(intent.status!=='UPLOADED'||intent.checksumSha256!==dto.checksumSha256)throw new ConflictException('图片尚未上传完成或校验值不匹配');
    const head=await this.storage.head(intent.objectKey);
    if(head.bytes!==intent.declaredBytes||head.mimeType!==intent.mimeType||head.checksumSha256!==dto.checksumSha256)throw new ConflictException('对象存储中的图片校验失败');
    return serializable(this.prisma,async tx=>{
      const member=await this.access.require(userId,householdId,'recipes','EDIT',tx);
      const current=await tx.uploadIntent.findFirst({where:{id:intent.id,householdId}});if(!current)throw new NotFoundException('上传申请不存在');
      if(current.requestedById!==member.id&&!permits(member.effectivePermissions,'recipes','MANAGE'))throw new NotFoundException('上传申请不存在');
      if(current.status==='CONFIRMED'){const asset=await tx.mediaAsset.findUniqueOrThrow({where:{intentId:current.id}});const recipe=await tx.recipe.findUnique({where:{id:current.ownerId}});return{data:{asset,ownerVersion:recipe?.version}};}
      if(current.status!=='UPLOADED'||current.checksumSha256!==dto.checksumSha256)throw new ConflictException('上传状态已经变化');
      const recipe=await tx.recipe.findFirst({where:{id:current.ownerId,householdId}});if(!recipe)throw new NotFoundException('菜谱不存在');
      if(recipe.version!==current.expectedOwnerVersion)throw new ConflictException('上传期间菜谱已被修改，请重新选择图片');
      const asset=await tx.mediaAsset.create({data:{householdId,intentId:current.id,objectKey:current.objectKey,mimeType:current.mimeType,byteSize:current.uploadedBytes!,checksumSha256:current.checksumSha256,createdById:member.id}});
      await tx.mediaReference.create({data:{householdId,assetId:asset.id,ownerType:current.ownerType,ownerId:current.ownerId}});
      await tx.recipe.update({where:{id:recipe.id},data:{coverAssetId:asset.id,version:{increment:1}}});
      await tx.uploadIntent.update({where:{id:current.id},data:{status:'CONFIRMED'}});
      await tx.auditLog.create({data:{householdId,actorMembershipId:member.id,action:'RECIPE_COVER_CONFIRM',targetId:recipe.id,details:{assetId:asset.id,fromVersion:recipe.version,toVersion:recipe.version+1}}});
      return{data:{asset,ownerVersion:recipe.version+1}};
    });
  }

  async issueReadUrl(userId:string,householdId:string,assetId:string){
    const asset=await this.prisma.mediaAsset.findFirst({where:{id:assetId,householdId,status:'READY'},include:{references:true}});if(!asset)throw new NotFoundException('图片不存在');
    let allowed=false;
    for(const reference of asset.references){if(reference.ownerType!==MediaOwnerType.RECIPE)continue;const recipe=await this.prisma.recipe.findFirst({where:{id:reference.ownerId,householdId}});if(!recipe)continue;const member=await this.access.require(userId,householdId,'recipes',recipe.status===RecipeStatus.PUBLISHED?'VIEW':'EDIT');if(permits(member.effectivePermissions,'recipes',recipe.status===RecipeStatus.PUBLISHED?'VIEW':'EDIT')){allowed=true;break;}}
    if(!allowed)throw new NotFoundException('图片不存在');
    const token=await this.jwt.signAsync({typ:'media',assetId:asset.id,householdId},{expiresIn:60,audience:'media'});
    return{data:{path:`/media/public/${encodeURIComponent(token)}`,expiresAt:new Date(Date.now()+60_000).toISOString()}};
  }

  async readPublic(token:string){
    let payload:{typ?:string;assetId?:string;householdId?:string};try{payload=await this.jwt.verifyAsync(token,{audience:'media'});}catch{throw new NotFoundException('图片链接无效或已过期');}
    if(payload.typ!=='media'||!payload.assetId||!payload.householdId)throw new NotFoundException('图片链接无效');
    const asset=await this.prisma.mediaAsset.findFirst({where:{id:payload.assetId,householdId:payload.householdId,status:'READY'}});if(!asset)throw new NotFoundException('图片不存在');
    return this.storage.get(asset.objectKey);
  }

  private async intentFor(userId:string,householdId:string,intentId:string){const intent=await this.prisma.uploadIntent.findFirst({where:{id:intentId,householdId}});if(!intent)throw new NotFoundException('上传申请不存在');if(intent.ownerType!==MediaOwnerType.RECIPE)throw new BadRequestException('不支持的图片归属');const member=await this.access.require(userId,householdId,'recipes','EDIT');if(intent.requestedById!==member.id&&!permits(member.effectivePermissions,'recipes','MANAGE'))throw new NotFoundException('上传申请不存在');const recipe=await this.prisma.recipe.findFirst({where:{id:intent.ownerId,householdId}});if(!recipe)throw new NotFoundException('菜谱不存在');return intent;}
  private async notExpired(intent:{id:string;expiresAt:Date;status:string}){if(intent.expiresAt.getTime()<=Date.now()&&intent.status!=='CONFIRMED'){await this.prisma.uploadIntent.updateMany({where:{id:intent.id,status:{in:['PENDING','UPLOADED']}},data:{status:'EXPIRED'}});throw new GoneException('上传申请已过期');}}
}
