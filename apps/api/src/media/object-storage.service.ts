import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import COS = require('cos-nodejs-sdk-v5');

export interface StoredObjectHead { bytes: number; mimeType: string; checksumSha256: string; }
interface StoredObject extends StoredObjectHead { body: Buffer; }

@Injectable()
export class ObjectStorageService {
  private readonly logger = new Logger(ObjectStorageService.name);
  private readonly driver: string;
  private readonly memory = new Map<string, StoredObject>();
  private readonly cos?: COS;
  private readonly bucket?: string;
  private readonly region?: string;

  constructor(config: ConfigService) {
    this.driver = config.get<string>('MEDIA_DRIVER') ?? 'disabled';
    if (this.driver === 'memory' && config.get<string>('NODE_ENV') !== 'test') throw new Error('MEDIA_DRIVER=memory 仅允许测试环境');
    if (this.driver === 'cos') {
      this.bucket = config.getOrThrow<string>('COS_BUCKET'); this.region = config.getOrThrow<string>('COS_REGION');
      this.cos = new COS({ SecretId: config.getOrThrow<string>('COS_SECRET_ID'), SecretKey: config.getOrThrow<string>('COS_SECRET_KEY'), UploadCheckContentMd5: true, ForceSignHost: true });
    }
  }

  private unavailable(): never { throw new ServiceUnavailableException('图片存储尚未配置'); }
  assertAvailable(){if(this.driver==='disabled')this.unavailable();}

  async put(key: string, body: Buffer, mimeType: string, checksumSha256: string) {
    if (this.driver === 'memory') { this.memory.set(key, { body: Buffer.from(body), bytes: body.length, mimeType, checksumSha256 }); return; }
    if (!this.cos || !this.bucket || !this.region) this.unavailable();
    try { await this.cos.putObject({ Bucket: this.bucket, Region: this.region, Key: key, Body: body, ContentLength: body.length, ContentType: mimeType, ACL: 'private', 'x-cos-meta-sha256': checksumSha256 }); }
    catch (error) { this.logger.error(`COS putObject failed: ${this.errorCode(error)}`); this.unavailable(); }
  }

  async head(key: string): Promise<StoredObjectHead> {
    if (this.driver === 'memory') { const item=this.memory.get(key); if(!item)this.unavailable(); return { bytes:item.bytes,mimeType:item.mimeType,checksumSha256:item.checksumSha256 }; }
    if (!this.cos || !this.bucket || !this.region) this.unavailable();
    try {
      const result=await this.cos.headObject({ Bucket:this.bucket,Region:this.region,Key:key }); const headers=result.headers ?? {};
      return { bytes:Number(headers['content-length']),mimeType:String(headers['content-type']??''),checksumSha256:String(headers['x-cos-meta-sha256']??'') };
    } catch(error){this.logger.error(`COS headObject failed: ${this.errorCode(error)}`);this.unavailable();}
  }

  async get(key: string): Promise<{ body: Buffer; mimeType: string }> {
    if (this.driver === 'memory') { const item=this.memory.get(key); if(!item)this.unavailable(); return {body:Buffer.from(item.body),mimeType:item.mimeType}; }
    if (!this.cos || !this.bucket || !this.region) this.unavailable();
    try { const result=await this.cos.getObject({Bucket:this.bucket,Region:this.region,Key:key});return {body:result.Body,mimeType:String(result.headers?.['content-type']??'application/octet-stream')}; }
    catch(error){this.logger.error(`COS getObject failed: ${this.errorCode(error)}`);this.unavailable();}
  }

  private errorCode(error: unknown) { return typeof error === 'object' && error && 'code' in error ? String(error.code) : 'unknown'; }
}
