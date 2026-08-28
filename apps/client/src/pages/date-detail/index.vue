<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { calendarEvents, eventLabels, eventStamps } from '../../data/calendar';

const date = ref('');
const events = computed(() => calendarEvents.filter((event) => event.date === date.value));
const dateTitle = computed(() => date.value ? `${date.value.replaceAll('-', '年').replace(/年(\d{2})$/, '月$1日')}` : '当天安排');
onLoad((query) => { date.value = String(query.date || '2026-08-29'); });
function openEvent(target: string) {
  const page = target === 'meal' ? '/pages/meal/index' : target === 'camping' ? '/pages/camping/index' : target === 'shopping' ? '/pages/shopping/index' : '/pages/profile/index';
  uni.switchTab({ url: page });
}
function addEvent() { uni.showToast({ title: '新建安排将在下一步接入', icon: 'none' }); }
</script>
<template><view class="page"><view class="heading"><text class="label">扣扣的家 · 日历</text><text class="title">{{ dateTitle }}</text><text class="subtitle">点击事件可进入对应功能</text></view><view v-if="events.length" class="event-list"><view v-for="event in events" :key="event.id" class="event" @tap="openEvent(event.target)"><text class="stamp" :class="event.kind">{{ eventStamps[event.kind] }}</text><view><text class="kind">{{ eventLabels[event.kind] }}</text><text class="event-title">{{ event.title }}</text></view><text class="chevron">›</text></view></view><view v-else class="empty"><text class="empty-icon">☁</text><text>这一天还没有安排</text><text class="hint">给日子留一点空白，也很好。</text></view><view class="add" @tap="addEvent">+ 添加当天安排</view></view></template>
<style scoped>.page{min-height:100vh;padding:40rpx 30rpx;background:#f7f3e8}.heading .label,.heading .title,.heading .subtitle,.kind,.event-title,.hint{display:block}.label{font-size:23rpx;letter-spacing:3rpx;color:#78917a}.title{margin-top:12rpx;font-size:44rpx;font-weight:700;color:#3b5141}.subtitle{margin-top:10rpx;color:#928a7f;font-size:25rpx}.event-list{margin-top:38rpx}.event{display:flex;align-items:center;gap:20rpx;margin-bottom:18rpx;padding:25rpx;border-radius:25rpx;background:#fffdf7}.stamp{display:flex;align-items:center;justify-content:center;width:64rpx;height:64rpx;border-radius:50%;font-size:32rpx}.anniversary{background:#ffdbe4}.meal{background:#ffe9bd}.camping{background:#d9eee0}.task{background:#ddeaff}.kind{font-size:20rpx;color:#9b9287}.event-title{margin-top:6rpx;font-size:29rpx;color:#4b544b}.chevron{margin-left:auto;font-size:44rpx;color:#baaF9d}.empty{display:flex;flex-direction:column;align-items:center;gap:12rpx;margin-top:110rpx;color:#877f73}.empty-icon{font-size:78rpx}.hint{font-size:23rpx}.add{margin-top:40rpx;padding:25rpx;border-radius:24rpx;background:#75aa78;color:white;text-align:center;font-size:29rpx}</style>
