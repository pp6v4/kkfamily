<script setup lang="ts">
import { ref, watch } from 'vue';
import { confirmMediaAsset, createMediaUploadIntent, getMediaReadUrl, listTripPhotos, publicMediaUrl, uploadMediaContent, type Trip, type TripPhoto } from '../services/family-api';

const props=defineProps<{trip:Trip;canUpload:boolean}>();
const emit=defineEmits<{changed:[version:number,tripId:string]}>();
const photos=ref<Array<TripPhoto&{url:string}>>([]);
const loading=ref(false),uploading=ref(false);

function message(error:unknown){return error instanceof Error?error.message:'操作失败';}
function mimeFor(path:string){const clean=path.toLowerCase().split('?')[0];if(clean.endsWith('.jpg')||clean.endsWith('.jpeg'))return'image/jpeg' as const;if(clean.endsWith('.png'))return'image/png' as const;if(clean.endsWith('.webp'))return'image/webp' as const;throw new Error('请选择 JPG、PNG 或 WebP 图片');}
function readBytes(path:string){return new Promise<ArrayBuffer>((resolve,reject)=>{uni.getFileSystemManager().readFile({filePath:path,success(result){if(typeof result.data==='string')reject(new Error('图片读取格式错误'));else resolve(result.data as ArrayBuffer);},fail(error){reject(new Error(error.errMsg||'图片读取失败'));}});});}
async function load(){loading.value=true;try{const rows=await listTripPhotos(props.trip.id);photos.value=(await Promise.all(rows.map(async row=>{try{const read=await getMediaReadUrl(row.id);return{...row,url:publicMediaUrl(read.path)};}catch{return undefined;}}))).filter((row):row is TripPhoto&{url:string}=>Boolean(row));}catch(error){uni.showToast({title:message(error),icon:'none'});}finally{loading.value=false;}}
watch(()=>props.trip.id,load,{immediate:true});

async function choosePhotos(){
  if(uploading.value||!props.canUpload)return;
  try{
    const selected=await new Promise<Array<{tempFilePath:string;size:number}>>((resolve,reject)=>uni.chooseMedia({count:9,mediaType:['image'],sourceType:['album','camera'],success(result){resolve(result.tempFiles.map(file=>({tempFilePath:file.tempFilePath,size:file.size})));},fail(error){reject(new Error(error.errMsg||'未选择图片'));}}));
    if(selected.some(file=>file.size>8*1024*1024))throw new Error('每张图片不能超过 8MB');
    uploading.value=true;
    let ownerVersion=props.trip.version;
    for(const file of selected){
      const mimeType=mimeFor(file.tempFilePath),bytes=await readBytes(file.tempFilePath);
      if(bytes.byteLength!==file.size)throw new Error('图片读取大小不一致，请重新选择');
      const intent=await createMediaUploadIntent({ownerType:'TRIP',ownerId:props.trip.id,expectedOwnerVersion:ownerVersion,mimeType,byteSize:bytes.byteLength});
      const uploaded=await uploadMediaContent(intent.uploadPath,bytes,mimeType);
      const confirmed=await confirmMediaAsset(intent.id,uploaded.checksumSha256);ownerVersion=confirmed.ownerVersion;
    }
    emit('changed',ownerVersion,props.trip.id);await load();uni.showToast({title:`已添加 ${selected.length} 张照片`,icon:'success'});
  }catch(error){const text=message(error);if(!text.includes('cancel'))uni.showToast({title:text,icon:'none',duration:3000});}finally{uploading.value=false;}
}
function preview(index:number){uni.previewImage({current:photos.value[index].url,urls:photos.value.map(photo=>photo.url)});}
</script>

<template>
  <view class="photo-card">
    <view class="photo-head"><view><text class="eyebrow">旅途相册</text><text class="title">一路的小记忆</text></view><text v-if="canUpload" class="add" @tap="choosePhotos">{{uploading?'上传中…':'＋ 添加照片'}}</text></view>
    <view v-if="photos.length" class="grid"><view v-for="(photo,index) in photos" :key="photo.id" class="photo-wrap" @tap="preview(index)"><image class="photo" :src="photo.url" mode="aspectFill"/><text class="author">{{photo.createdBy.nickname||'同行成员'}}</text></view></view>
    <text v-else class="empty">{{loading?'正在读取相册…':'还没有照片，旅途中或回来后都可以添加。'}}</text>
    <text class="note">照片仅向这趟行程的当前或历史成员开放；撤权后不能再获取新的查看链接。</text>
  </view>
</template>

<style scoped>
.photo-card{margin-top:16rpx;padding:22rpx;border-radius:26rpx;background:#fffdf7}.photo-head{display:flex;align-items:flex-start;justify-content:space-between}.eyebrow,.title,.empty,.note,.author{display:block}.eyebrow{color:#c48b62;font-size:19rpx}.title{margin-top:4rpx;color:#554d43;font-size:29rpx;font-weight:650}.add{padding:11rpx 15rpx;border-radius:14rpx;background:#f1dcc8;color:#986642;font-size:20rpx}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10rpx;margin-top:18rpx}.photo-wrap{position:relative;height:190rpx;overflow:hidden;border-radius:16rpx;background:#eee6dc}.photo{width:100%;height:100%}.author{position:absolute;right:6rpx;bottom:6rpx;max-width:85%;padding:5rpx 8rpx;border-radius:9rpx;background:rgba(40,50,43,.62);color:#fff;font-size:16rpx;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.empty{padding:36rpx 0 20rpx;color:#969188;text-align:center;font-size:21rpx}.note{margin-top:14rpx;color:#9a9288;font-size:19rpx;line-height:1.55}
</style>
