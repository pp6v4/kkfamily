<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { setCalendarTarget } from '../../services/calendar-navigation';
import { refreshAccess } from '../../services/session';
import { createCalendarEvent, listCalendarEvents, type CalendarEvent } from '../../services/family-api';

const date = ref('');
const events = ref<CalendarEvent[]>([]);
const adding = ref(false);
const title = ref('');
const eventType = ref<CalendarEvent['type']>('ANNIVERSARY');
const types: Array<{ value: CalendarEvent['type']; label: string }> = [{ value: 'ANNIVERSARY', label: '纪念日' }];
const eventLabels: Record<CalendarEvent['type'], string> = { ANNIVERSARY: '纪念日', MEAL: '吃什么', TRIP: '去露营', TASK: '家庭待办' };
const eventStamps: Record<CalendarEvent['type'], string> = { ANNIVERSARY: '❤', MEAL: '🍲', TRIP: '⛺', TASK: '✓' };
const typeClass: Record<CalendarEvent['type'], string> = { ANNIVERSARY: 'anniversary', MEAL: 'meal', TRIP: 'camping', TASK: 'task' };
const dateTitle = computed(() => date.value ? `${date.value.slice(0, 4)}年${Number(date.value.slice(5, 7))}月${Number(date.value.slice(8, 10))}日` : '当天安排');
function message(error: unknown) { return error instanceof Error ? error.message : '操作失败'; }
async function loadEvents() {
  if (!date.value) return;
  events.value=[];
  try { await refreshAccess(); const from=`${date.value}T00:00:00+08:00`; const to=new Date(new Date(from).getTime()+86400_000).toISOString(); events.value=await listCalendarEvents(from,to); }
  catch(error) { uni.showToast({title:message(error),icon:'none'}); }
}
function openEvent(event: CalendarEvent) {
  if (event.type==='MEAL' || event.type==='TRIP') {
    setCalendarTarget({type:event.type,date:date.value,sourceId:event.sourceId || undefined,mealType:event.type==='MEAL'?event.title:undefined});
    uni.switchTab({url:event.type==='MEAL'?'/pages/meal/index':'/pages/camping/index'});
  } else { uni.showModal({title:'纪念日',content:event.title,showCancel:false}); }
}
function planMeal() { setCalendarTarget({type:'MEAL',date:date.value}); uni.switchTab({url:'/pages/meal/index'}); }
function planTrip() { setCalendarTarget({type:'TRIP',date:date.value}); uni.switchTab({url:'/pages/camping/index'}); }
async function saveEvent() {
  if (!title.value.trim()) { uni.showToast({ title: '请输入安排内容', icon: 'none' }); return; }
  try { await createCalendarEvent({ type: eventType.value, title: title.value.trim(), startsAt: `${date.value}T09:00:00+08:00` }); title.value = ''; adding.value = false; await loadEvents(); uni.showToast({ title: '已添加', icon: 'success' }); }
  catch (error) { uni.showToast({ title: message(error), icon: 'none' }); }
}
onLoad((query) => { const now = new Date(); date.value = String(query.date || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`); });
onShow(loadEvents);
</script>

<template>
  <view class="page"><view class="heading"><text class="label">扣扣的家 · 日历</text><text class="page-title">{{ dateTitle }}</text><text class="subtitle">点击事件可进入对应功能</text></view>
    <view v-if="events.length" class="event-list"><view v-for="event in events" :key="event.id" class="event" @tap="openEvent(event)"><text class="stamp" :class="typeClass[event.type]">{{ eventStamps[event.type] }}</text><view><text class="kind">{{ eventLabels[event.type] }}</text><text class="event-title">{{ event.title }}</text></view><text class="chevron">›</text></view></view>
    <view v-else class="empty"><text class="empty-icon">☁</text><text>这一天还没有安排</text></view>
    <view v-if="adding" class="editor"><view class="type-row"><text v-for="item in types" :key="item.value" class="type" :class="{ chosen: eventType === item.value }" @tap="eventType = item.value">{{ item.label }}</text></view><input v-model="title" class="input" placeholder="安排内容" /><view class="save" @tap="saveEvent">保存安排</view></view>
    <view v-else class="add" @tap="adding = true">+ 添加纪念日</view>
    <view class="add" @tap="planMeal">安排当天餐点</view><view class="add" @tap="planTrip">从这天计划出行</view>
  </view>
</template>

<style scoped>
.page{min-height:100vh;padding:40rpx 30rpx;background:#f7f3e8}.heading .label,.heading .page-title,.heading .subtitle,.kind,.event-title{display:block}.label{font-size:23rpx;letter-spacing:3rpx;color:#78917a}.page-title{margin-top:12rpx;font-size:44rpx;font-weight:700;color:#3b5141}.subtitle{margin-top:10rpx;color:#928a7f;font-size:25rpx}.event-list{margin-top:38rpx}.event{display:flex;align-items:center;gap:20rpx;margin-bottom:18rpx;padding:25rpx;border-radius:25rpx;background:#fffdf7}.stamp{display:flex;align-items:center;justify-content:center;width:64rpx;height:64rpx;border-radius:50%;font-size:32rpx}.anniversary{background:#ffdbe4}.meal{background:#ffe9bd}.camping{background:#d9eee0}.task{background:#ddeaff}.kind{font-size:20rpx;color:#9b9287}.event-title{margin-top:6rpx;font-size:29rpx;color:#4b544b}.chevron{margin-left:auto;font-size:44rpx;color:#baaf9d}.empty{display:flex;flex-direction:column;align-items:center;gap:12rpx;margin-top:90rpx;color:#877f73}.empty-icon{font-size:78rpx}.add,.save{margin-top:40rpx;padding:25rpx;border-radius:24rpx;background:#75aa78;color:white;text-align:center;font-size:29rpx}.editor{margin-top:35rpx;padding:24rpx;border-radius:24rpx;background:#fff}.type-row{display:flex;flex-wrap:wrap;gap:12rpx}.type{padding:12rpx 18rpx;border-radius:99rpx;background:#eef1e9;color:#718072;font-size:22rpx}.type.chosen{background:#d6ead4;color:#47744e}.input{box-sizing:border-box;width:100%;margin-top:20rpx;padding:20rpx;border:2rpx solid #e4e8df;border-radius:16rpx;font-size:25rpx}.save{margin-top:20rpx}
</style>
