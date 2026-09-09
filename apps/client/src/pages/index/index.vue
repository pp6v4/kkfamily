<script setup lang="ts">
import { computed, ref } from 'vue';
import { onHide, onShow, onUnload } from '@dcloudio/uni-app';
import { listCalendarEvents, type CalendarEvent } from '../../services/family-api';
import { canAccess, getStoredSession, refreshAccess, type HouseholdContext } from '../../services/session';
import { gridRange, monthGrid, overlapsDay, shiftMonth, todayInShanghai } from '../../services/calendar-dates';
import { isCalendarDate } from '../../services/trip-form';

const today = ref(todayInShanghai());
const current = ref(`${today.value.slice(0, 7)}-01`);
const selected = ref(today.value);
const events = ref<CalendarEvent[]>([]);
const loading = ref(false);
const loadError = ref('');
const session = ref<HouseholdContext>();
const pageVisible = ref(false);
let epoch = 0;
let disposed = false;
const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
const eventStamps: Record<CalendarEvent['type'], string> = { ANNIVERSARY: '❤', MEAL: '🍲', TRIP: '⛺', TASK: '✓' };
const typeClass: Record<CalendarEvent['type'], string> = { ANNIVERSARY: 'anniversary', MEAL: 'meal', TRIP: 'camping', TASK: 'task' };
function message(error: unknown) { return error instanceof Error ? error.message : '日历加载失败'; }
function sameIdentity(a?: HouseholdContext, b?: HouseholdContext) {
  return Boolean(a && b && a.householdId === b.householdId && a.membershipId === b.membershipId);
}
function alive(token: number) { return !disposed && pageVisible.value && token === epoch; }
function clearPrivate() { events.value = []; session.value = undefined; }
function leave() { pageVisible.value = false; epoch++; clearPrivate(); loading.value = false; loadError.value = ''; }

const title = computed(() => `${Number(current.value.slice(0, 4))} 年 ${Number(current.value.slice(5, 7))} 月`);
const days = computed(() => monthGrid(current.value).map(day => ({ ...day, events: events.value.filter(event => overlapsDay(event, day.key)) })));
async function loadMonth() {
  if (disposed || !pageVisible.value) return;
  const token = ++epoch, identity = getStoredSession(), month = current.value;
  clearPrivate(); loadError.value = '';
  loading.value = true;
  try {
    const refreshed = await refreshAccess();
    if (!alive(token)) return;
    if ((identity && !sameIdentity(identity, refreshed)) || !sameIdentity(refreshed, getStoredSession())) { loadError.value = '账号或家庭已变化，请重新加载'; return; }
    if (!canAccess(refreshed, 'calendar')) { loadError.value = '尚未获得日历查看权限'; return; }
    session.value = refreshed;
    const { from, to } = gridRange(month);
    const rows = await listCalendarEvents(from, to);
    if (alive(token) && sameIdentity(refreshed, getStoredSession())) events.value = rows;
  } catch (error) {
    if (!alive(token)) return;
    clearPrivate(); loadError.value = message(error);
  } finally {
    if (alive(token)) {
      if (session.value && !sameIdentity(session.value, getStoredSession())) { clearPrivate(); loadError.value = '账号或家庭已变化，请重新加载'; }
      loading.value = false;
    }
  }
}
async function changeMonth(delta: number) {
  if (!pageVisible.value || disposed) return;
  current.value = shiftMonth(current.value, delta); await loadMonth();
}
function selectDay(key: string) {
  if (!pageVisible.value || disposed || loading.value || loadError.value || !isCalendarDate(key)) return;
  if (!sameIdentity(session.value, getStoredSession()) || !canAccess(session.value, 'calendar')) { clearPrivate(); loadError.value = '请重新加载日历以确认权限'; return; }
  selected.value = key; uni.navigateTo({ url: `/pages/date-detail/index?date=${key}` });
}
onShow(() => { if (disposed) return; pageVisible.value = true; today.value = todayInShanghai(); return loadMonth(); });
onHide(leave);
onUnload(() => { disposed = true; leave(); });
</script>

<template>
  <view class="page">
    <view class="top"><view><text class="eyebrow">{{session?.householdName||'扣扣的家'}}</text><text class="headline">家庭日历</text></view><view class="avatar">🏡</view></view>
    <view class="calendar-card"><view class="month"><text class="arrow" @tap="changeMonth(-1)">‹</text><text class="month-title">{{ title }}</text><text class="arrow" @tap="changeMonth(1)">›</text></view><view class="weekdays"><text v-for="day in weekdays" :key="day">{{ day }}</text></view><view class="days"><view v-for="item in days" :key="item.key" class="day" :class="{ muted: !item.isCurrent, today: item.key === today, selected: item.key === selected }" @tap="selectDay(item.key)"><text class="date">{{ item.day }}</text><view class="stamps"><text v-for="event in item.events.slice(0, 3)" :key="event.id" class="stamp" :class="typeClass[event.type]">{{ eventStamps[event.type] }}</text><text v-if="item.events.length > 3" class="more">+{{ item.events.length - 3 }}</text></view></view></view></view>
    <view class="legend"><view><text class="legend-stamp anniversary">❤</text><text>纪念日</text></view><view><text class="legend-stamp meal">🍲</text><text>吃什么</text></view><view><text class="legend-stamp camping">⛺</text><text>去露营</text></view><view><text class="legend-stamp task">✓</text><text>待办</text></view></view>
    <view v-if="loading" class="tip"><text>正在加载日历…</text></view>
    <view v-else-if="loadError" class="tip" @tap="loadMonth"><text>{{ loadError }}</text><text class="tip-copy">重试 ›</text></view>
    <view v-else class="tip" @tap="selectDay(selected)"><text>当天安排</text><text class="tip-copy">查看或添加事件 ›</text></view>
  </view>
</template>

<style scoped>
.page{min-height:100vh;padding:34rpx 28rpx 46rpx;background:linear-gradient(180deg,#e8f4d7 0,#f7f3e8 34%)}.top{display:flex;align-items:center;justify-content:space-between;padding:22rpx 10rpx 34rpx}.eyebrow,.headline{display:block}.eyebrow{font-size:24rpx;letter-spacing:4rpx;color:#68836d}.headline{margin-top:8rpx;font-size:43rpx;font-weight:700;color:#33483c}.avatar{display:flex;align-items:center;justify-content:center;width:82rpx;height:82rpx;border-radius:50%;background:#fff8e8;font-size:44rpx;box-shadow:0 8rpx 18rpx rgba(71,106,70,.13)}.calendar-card{padding:26rpx 18rpx 18rpx;border:4rpx solid #fffdf7;border-radius:32rpx;background:#fffdf7;box-shadow:0 12rpx 28rpx rgba(78,105,73,.13)}.month{display:flex;align-items:center;justify-content:space-between;padding:0 12rpx 22rpx}.month-title{font-size:32rpx;font-weight:700;color:#3f5948}.arrow{width:58rpx;height:52rpx;line-height:46rpx;text-align:center;border-radius:18rpx;background:#edf5df;font-size:48rpx;color:#5d956d}.weekdays,.days{display:grid;grid-template-columns:repeat(7,1fr)}.weekdays text{text-align:center;font-size:22rpx;color:#9b958a}.days{row-gap:6rpx}.day{min-height:95rpx;padding-top:12rpx;text-align:center;border-radius:18rpx}.day:active{background:#f1f7e7}.date{font-size:25rpx;color:#4d574d}.muted .date{color:#d4cec4}.today .date{display:inline-flex;align-items:center;justify-content:center;width:38rpx;height:38rpx;border-radius:50%;background:#7cb178;color:#fff}.selected{background:#fff2ca}.stamps{display:flex;justify-content:center;gap:2rpx;margin-top:5rpx;min-height:27rpx}.stamp,.more,.legend-stamp{display:inline-flex;align-items:center;justify-content:center;width:25rpx;height:25rpx;border-radius:50%;font-size:16rpx;font-weight:700}.anniversary{background:#ffdbe4;color:#d76682}.meal{background:#ffe9bd}.camping{background:#d9eee0}.task{background:#ddeaff;color:#547dc5}.more{background:#eeeae2;color:#8c8578;font-size:14rpx}.legend{display:flex;justify-content:space-around;padding:30rpx 0 20rpx}.legend view{display:flex;flex-direction:column;align-items:center;gap:8rpx;font-size:19rpx;color:#837d73}.legend-stamp{width:34rpx;height:34rpx}.tip{display:flex;justify-content:space-between;align-items:center;padding:26rpx 30rpx;border-radius:24rpx;background:#fff5d6;color:#5f5749;font-size:27rpx}.tip-copy{font-size:22rpx;color:#9a8e77}
</style>
