<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import { ApiError } from '../services/transport';
import { getMediaReadUrl, listTripPhotos, publicMediaUrl, type Trip, type TripPhoto } from '../services/family-api';

const props=defineProps<{trip:Trip;canUpload:boolean;active:boolean}>();
const emit=defineEmits<{choosePhotos:[tripId:string];preview:[tripId:string,photoId:string];accessLost:[tripId:string]}>();
const photos=ref<Array<TripPhoto&{url:string}>>([]);
const loading=ref(false);
let epoch=0,disposed=false;

function message(error:unknown){return error instanceof Error?error.message:'操作失败';}
async function load(){
  const token=++epoch,tripId=props.trip.id;photos.value=[];loading.value=false;
  const current=()=>!disposed&&props.active&&epoch===token&&props.trip.id===tripId;
  if(!current())return;loading.value=true;
  try{
    const rows=await listTripPhotos(tripId);if(!current())return;
    const signed=await Promise.all(rows.map(async row=>{const read=await getMediaReadUrl(row.id);return{...row,url:publicMediaUrl(read.path)};}));
    if(current())photos.value=signed;
  }catch(error){if(current()){if(error instanceof ApiError&&[401,403].includes(error.statusCode))emit('accessLost',tripId);else uni.showToast({title:message(error),icon:'none'});}}finally{if(current())loading.value=false;}
}
watch(()=>[props.trip.id,props.active],load,{immediate:true,flush:'sync'});
onUnmounted(()=>{disposed=true;epoch++;photos.value=[];loading.value=false;});
function choosePhotos(){if(!disposed&&props.active&&props.canUpload)emit('choosePhotos',props.trip.id);}
function preview(index:number){const photo=photos.value[index];if(!disposed&&props.active&&photo)emit('preview',props.trip.id,photo.id);}
</script>

<template>
  <view class="photo-card">
    <view class="photo-head"><view><text class="eyebrow">旅途相册</text><text class="title">一路的小记忆</text></view><text v-if="canUpload" class="add" @tap="choosePhotos">＋ 添加照片</text></view>
    <view v-if="photos.length" class="grid"><view v-for="(photo,index) in photos" :key="photo.id" class="photo-wrap" @tap="preview(index)"><image class="photo" :src="photo.url" mode="aspectFill"/><text class="author">{{photo.createdBy.nickname||'同行成员'}}</text></view></view>
    <text v-else class="empty">{{loading?'正在读取相册…':'还没有照片，旅途中或回来后都可以添加。'}}</text>
    <text class="note">照片仅向这趟行程的当前或历史成员开放；撤权后不能再获取新的查看链接。</text>
  </view>
</template>

<style scoped>
.photo-card{margin-top:16rpx;padding:22rpx;border-radius:26rpx;background:#fffdf7}.photo-head{display:flex;align-items:flex-start;justify-content:space-between}.eyebrow,.title,.empty,.note,.author{display:block}.eyebrow{color:#c48b62;font-size:19rpx}.title{margin-top:4rpx;color:#554d43;font-size:29rpx;font-weight:650}.add{padding:11rpx 15rpx;border-radius:14rpx;background:#f1dcc8;color:#986642;font-size:20rpx}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10rpx;margin-top:18rpx}.photo-wrap{position:relative;height:190rpx;overflow:hidden;border-radius:16rpx;background:#eee6dc}.photo{width:100%;height:100%}.author{position:absolute;right:6rpx;bottom:6rpx;max-width:85%;padding:5rpx 8rpx;border-radius:9rpx;background:rgba(40,50,43,.62);color:#fff;font-size:16rpx;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.empty{padding:36rpx 0 20rpx;color:#969188;text-align:center;font-size:21rpx}.note{margin-top:14rpx;color:#9a9288;font-size:19rpx;line-height:1.55}
</style>
