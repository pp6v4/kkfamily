<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { getPublicNotificationSettings, listInbox, listNotificationPreferences, readInboxItem, recordSubscriptionReceipt, updateNotificationPreference, type InboxItem, type NotificationPreference } from '../../services/family-api';
import { canAccess, refreshAccess, type HouseholdContext } from '../../services/session';

const session=ref<HouseholdContext>(),inbox=ref<InboxItem[]>([]),preference=ref<NotificationPreference>(),settings=ref<{taskReminderTemplateId:string|null;wechatSubscriptionAvailable:boolean}>(),busy=ref(false);
const unread=computed(()=>inbox.value.filter(item=>!item.readAt).length);
function message(error:unknown){return error instanceof Error?error.message:'操作失败';}
function time(value:string){const date=new Date(value);return`${date.getMonth()+1}月${date.getDate()}日 ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;}
async function load(){busy.value=true;try{session.value=await refreshAccess();if(!canAccess(session.value,'notifications'))return;const [messages,preferences,publicSettings]=await Promise.all([listInbox(),listNotificationPreferences(),getPublicNotificationSettings()]);inbox.value=messages;preference.value=preferences[0];settings.value=publicSettings;}catch(error){uni.showToast({title:message(error),icon:'none'});}finally{busy.value=false;}}
async function open(item:InboxItem){try{if(!item.readAt){const saved=await readInboxItem(item);const index=inbox.value.findIndex(row=>row.id===item.id);if(index>=0)inbox.value[index]={...item,version:saved.version,readAt:saved.readAt};}if(item.sourceType==='TASK')uni.navigateTo({url:`/pages/tasks/index?id=${item.sourceId}`});}catch(error){uni.showToast({title:message(error),icon:'none'});}}
async function toggle(enabled:boolean){const current=preference.value;if(!current)return;busy.value=true;try{preference.value=await updateNotificationPreference(current,{enabled,leadMinutes:current.leadMinutes,quietStart:current.quietStart,quietEnd:current.quietEnd});uni.showToast({title:enabled?'站内提醒已开启':'站内提醒已关闭',icon:'success'});}catch(error){uni.showToast({title:message(error),icon:'none'});}finally{busy.value=false;}}
async function subscribeWechat(){const templateId=settings.value?.taskReminderTemplateId;if(!templateId){uni.showToast({title:'微信订阅模板尚未配置，站内提醒不受影响',icon:'none',duration:3000});return;}try{const result=await new Promise<Record<string,string>>((resolve,reject)=>uni.requestSubscribeMessage({tmplIds:[templateId],success:resolve,fail:error=>reject(new Error(error.errMsg||'微信订阅请求失败'))}));const raw=result[templateId],mapped=raw==='accept'?'ACCEPT':raw==='ban'?'BAN':'REJECT';await recordSubscriptionReceipt({templateId,result:mapped,clientScene:'notification-settings'});uni.showToast({title:mapped==='ACCEPT'?'本次微信订阅已记录':'已保留站内提醒',icon:mapped==='ACCEPT'?'success':'none'});}catch(error){uni.showToast({title:message(error),icon:'none'});}}
onShow(load);
</script>

<template>
  <view class="page">
    <view class="head"><text class="eyebrow">消息与提醒</text><text class="title">该记得的，轻轻提醒</text><text class="subtitle">站内消息是主记录；微信订阅只在你主动点击后申请，不会反复弹窗。</text></view>
    <view class="card setting"><view><text class="setting-title">家庭待办站内提醒</text><text class="setting-note">按待办里明确设置的提醒时间生成</text></view><switch :checked="preference?.enabled!==false" color="#76a094" :disabled="busy" @change="toggle($event.detail.value)"/></view>
    <view class="card wechat"><view><text class="setting-title">微信订阅消息（辅助）</text><text class="setting-note">{{settings?.wechatSubscriptionAvailable?'模板已配置，可主动申请一次订阅':'模板尚未配置，当前只使用站内提醒'}}</text></view><view class="subscribe" @tap="subscribeWechat">主动申请</view></view>
    <view class="section"><text class="section-title">站内消息</text><text class="count">{{unread}} 条未读</text></view>
    <view v-for="item in inbox" :key="item.id" class="message" :class="{read:item.readAt}" @tap="open(item)"><text v-if="!item.readAt" class="dot"></text><view class="bell">🔔</view><view class="grow"><text class="message-title">{{item.title}}</text><text class="meta">待办提醒 · {{time(item.createdAt)}}</text></view><text class="go">›</text></view>
    <text v-if="!inbox.length" class="empty">暂时没有站内消息。</text>
    <text class="foot">待办完成、取消、重新分配或权限撤销后，失效消息会隐藏；提醒失败不会影响待办保存。</text>
  </view>
</template>

<style scoped>
.page{min-height:100vh;padding:36rpx 28rpx 70rpx;background:linear-gradient(180deg,#e6edf7,#f7f3e8 38%)}.eyebrow,.title,.subtitle,.setting-title,.setting-note,.section-title,.message-title,.meta,.empty,.foot{display:block}.eyebrow{color:#778da8;font-size:20rpx;letter-spacing:3rpx}.title{margin-top:8rpx;color:#4d5e75;font-size:40rpx;font-weight:700}.subtitle{margin-top:10rpx;color:#8b96a5;font-size:21rpx;line-height:1.55}.card,.message{margin-top:15rpx;padding:22rpx;border:3rpx solid #fff;border-radius:24rpx;background:#fffdf8;box-shadow:0 8rpx 18rpx rgba(70,83,103,.05)}.setting,.wechat{display:flex;align-items:center;justify-content:space-between;gap:15rpx}.setting-title{color:#546272;font-size:25rpx}.setting-note{margin-top:6rpx;color:#949da8;font-size:18rpx;line-height:1.45}.subscribe{flex:none;padding:13rpx 15rpx;border-radius:14rpx;background:#e5ebf5;color:#617590;font-size:19rpx}.section{display:flex;align-items:center;justify-content:space-between;margin-top:30rpx;padding:0 6rpx}.section-title{color:#596878;font-size:27rpx;font-weight:650}.count{color:#8996a4;font-size:19rpx}.message{position:relative;display:flex;align-items:center;gap:14rpx}.message.read{opacity:.72}.dot{position:absolute;left:12rpx;top:12rpx;width:13rpx;height:13rpx;border-radius:50%;background:#e98972}.bell{display:flex;align-items:center;justify-content:center;width:57rpx;height:57rpx;border-radius:18rpx;background:#e8edf6;font-size:28rpx}.grow{min-width:0;flex:1}.message-title{color:#556372;font-size:25rpx}.meta{margin-top:7rpx;color:#969faa;font-size:18rpx}.go{color:#bdc3ca;font-size:35rpx}.empty{padding:65rpx 0;color:#939da7;text-align:center;font-size:22rpx}.foot{margin-top:28rpx;color:#9aa1a8;text-align:center;font-size:18rpx;line-height:1.55}
</style>
