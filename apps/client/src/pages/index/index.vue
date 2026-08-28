<script setup lang="ts">
import { computed, ref } from 'vue';
import { calendarEvents, eventStamps } from '../../data/calendar';

const current = ref(new Date(2026, 7, 1));
const selected = ref('2026-08-29');
const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
const today = '2026-08-28';
const pad = (value: number) => String(value).padStart(2, '0');
const format = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const title = computed(() => `${current.value.getFullYear()} 年 ${current.value.getMonth() + 1} 月`);
const days = computed(() => {
  const year = current.value.getFullYear();
  const month = current.value.getMonth();
  const start = new Date(year, month, 1);
  const offset = start.getDay();
  const first = new Date(year, month, 1 - offset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(first);
    date.setDate(first.getDate() + index);
    const key = format(date);
    return { key, day: date.getDate(), isCurrent: date.getMonth() === month, events: calendarEvents.filter((event) => event.date === key) };
  });
});
function changeMonth(delta: number) { current.value = new Date(current.value.getFullYear(), current.value.getMonth() + delta, 1); }
function selectDay(key: string) { selected.value = key; uni.navigateTo({ url: `/pages/date-detail/index?date=${key}` }); }
</script>

<template>
  <view class="page">
    <view class="top"><view><text class="eyebrow">扣扣的家</text><text class="headline">把小日子，盖成纪念</text></view><view class="avatar">🏡</view></view>
    <view class="calendar-card"><view class="month"><text class="arrow" @tap="changeMonth(-1)">‹</text><text class="month-title">{{ title }}</text><text class="arrow" @tap="changeMonth(1)">›</text></view><view class="weekdays"><text v-for="day in weekdays" :key="day">{{ day }}</text></view><view class="days"><view v-for="item in days" :key="item.key" class="day" :class="{ muted: !item.isCurrent, today: item.key === today, selected: item.key === selected }" @tap="selectDay(item.key)"><text class="date">{{ item.day }}</text><view class="stamps"><text v-for="event in item.events.slice(0, 3)" :key="event.id" class="stamp" :class="event.kind">{{ eventStamps[event.kind] }}</text><text v-if="item.events.length > 3" class="more">+{{ item.events.length - 3 }}</text></view></view></view></view>
    <view class="legend"><view><text class="legend-stamp anniversary">❤</text><text>纪念日</text></view><view><text class="legend-stamp meal">🍲</text><text>吃什么</text></view><view><text class="legend-stamp camping">⛺</text><text>去露营</text></view><view><text class="legend-stamp task">✓</text><text>待办</text></view></view>
    <view class="tip" @tap="selectDay(selected)"><text>今日安排</text><text class="tip-copy">点日期查看或添加安排 ›</text></view>
  </view>
</template>

<style scoped>
.page{min-height:100vh;padding:34rpx 28rpx 46rpx;background:linear-gradient(180deg,#e8f4d7 0,#f7f3e8 34%)}.top{display:flex;align-items:center;justify-content:space-between;padding:22rpx 10rpx 34rpx}.eyebrow,.headline{display:block}.eyebrow{font-size:24rpx;letter-spacing:4rpx;color:#68836d}.headline{margin-top:8rpx;font-size:43rpx;font-weight:700;color:#33483c}.avatar{display:flex;align-items:center;justify-content:center;width:82rpx;height:82rpx;border-radius:50%;background:#fff8e8;font-size:44rpx;box-shadow:0 8rpx 18rpx rgba(71,106,70,.13)}.calendar-card{padding:26rpx 18rpx 18rpx;border:4rpx solid #fffdf7;border-radius:32rpx;background:#fffdf7;box-shadow:0 12rpx 28rpx rgba(78,105,73,.13)}.month{display:flex;align-items:center;justify-content:space-between;padding:0 12rpx 22rpx}.month-title{font-size:32rpx;font-weight:700;color:#3f5948}.arrow{width:58rpx;height:52rpx;line-height:46rpx;text-align:center;border-radius:18rpx;background:#edf5df;font-size:48rpx;color:#5d956d}.weekdays,.days{display:grid;grid-template-columns:repeat(7,1fr)}.weekdays text{text-align:center;font-size:22rpx;color:#9b958a}.days{row-gap:6rpx}.day{min-height:95rpx;padding-top:12rpx;text-align:center;border-radius:18rpx}.day:active{background:#f1f7e7}.date{font-size:25rpx;color:#4d574d}.muted .date{color:#d4cec4}.today .date{display:inline-flex;align-items:center;justify-content:center;width:38rpx;height:38rpx;border-radius:50%;background:#7cb178;color:#fff}.selected{background:#fff2ca}.stamps{display:flex;justify-content:center;gap:2rpx;margin-top:5rpx;min-height:27rpx}.stamp,.more,.legend-stamp{display:inline-flex;align-items:center;justify-content:center;width:25rpx;height:25rpx;border-radius:50%;font-size:16rpx;font-weight:700}.anniversary{background:#ffdbe4;color:#d76682}.meal{background:#ffe9bd}.camping{background:#d9eee0}.task{background:#ddeaff;color:#547dc5}.more{background:#eeeae2;color:#8c8578;font-size:14rpx}.legend{display:flex;justify-content:space-around;padding:30rpx 0 20rpx}.legend view{display:flex;flex-direction:column;align-items:center;gap:8rpx;font-size:19rpx;color:#837d73}.legend-stamp{width:34rpx;height:34rpx}.tip{display:flex;justify-content:space-between;align-items:center;padding:26rpx 30rpx;border-radius:24rpx;background:#fff5d6;color:#5f5749;font-size:27rpx}.tip-copy{font-size:22rpx;color:#9a8e77}
</style>

