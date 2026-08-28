<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { createTrip, listTrips, type Trip } from '../../services/family-api';

const trips = ref<Trip[]>([]);
const creating = ref(false);
const form = ref({ title: '', destination: '', startsAt: '', endsAt: '' });
function message(error: unknown) { return error instanceof Error ? error.message : '操作失败'; }
function dateText(value: string) { const date = new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function statusText(status: Trip['status']) { return ({ PLANNING: '规划中', PENDING: '待出行', DEPARTING: '旅途中', COMPLETED: '已完成', CANCELLED: '已取消' } as Record<Trip['status'], string>)[status]; }
async function loadTrips() { try { trips.value = await listTrips(); } catch (error) { uni.showToast({ title: message(error), icon: 'none' }); } }
async function saveTrip() {
  if (!form.value.title.trim() || !form.value.startsAt) { uni.showToast({ title: '请填写行程名称和出发日期', icon: 'none' }); return; }
  try {
    await createTrip({ title: form.value.title.trim(), destination: form.value.destination.trim() || undefined, startsAt: `${form.value.startsAt}T08:00:00+08:00`, endsAt: form.value.endsAt ? `${form.value.endsAt}T20:00:00+08:00` : undefined });
    form.value = { title: '', destination: '', startsAt: '', endsAt: '' }; creating.value = false; await loadTrips(); uni.showToast({ title: '行程已创建', icon: 'success' });
  } catch (error) { uni.showToast({ title: message(error), icon: 'none' }); }
}
onShow(loadTrips);
</script>

<template>
  <view class="page"><view class="heading"><text class="label">去露营</text><text class="title">我的行程</text><text class="subtitle">只有被加入行程的成员可以查看</text></view>
    <view class="map"><text class="map-icon">🗺️</text><text>中国行程地图</text><text class="map-note">路线绘制将在行程详情中接入</text></view>
    <view v-if="!trips.length" class="empty">还没有可查看的行程</view>
    <view v-for="trip in trips" :key="trip.id" class="trip"><view class="pin">📍</view><view class="trip-info"><text class="trip-title">{{ trip.title }}</text><text class="trip-sub">{{ trip.destination || '未填写目的地' }} · {{ dateText(trip.startsAt) }}{{ trip.endsAt ? ` 至 ${dateText(trip.endsAt)}` : '' }}</text></view><text class="state">{{ statusText(trip.status) }}</text></view>
    <view v-if="creating" class="editor"><input v-model="form.title" class="input" placeholder="行程名称" /><input v-model="form.destination" class="input" placeholder="目的地" /><view class="date-row"><picker mode="date" @change="form.startsAt = $event.detail.value"><view class="input">{{ form.startsAt || '出发日期' }}</view></picker><picker mode="date" @change="form.endsAt = $event.detail.value"><view class="input">{{ form.endsAt || '结束日期' }}</view></picker></view><view class="save" @tap="saveTrip">保存行程</view></view>
    <view v-else class="new" @tap="creating = true">＋ 创建露营行程</view>
  </view>
</template>

<style scoped>
.page{min-height:100vh;padding:38rpx 28rpx;background:#edf5eb}.heading .label,.heading .title,.heading .subtitle,.trip-title,.trip-sub,.map-note{display:block}.label{font-size:24rpx;letter-spacing:3rpx;color:#6e9770}.title{margin-top:10rpx;font-size:42rpx;font-weight:700;color:#3f5844}.subtitle{margin-top:11rpx;font-size:23rpx;color:#819183}.map{margin-top:28rpx;padding:30rpx;border-radius:28rpx;background:linear-gradient(135deg,#dcefd8,#dbeaf0);color:#4e6b54;text-align:center;font-size:28rpx}.map-icon{display:block;margin-bottom:10rpx;font-size:62rpx}.map-note{margin-top:8rpx;color:#819687;font-size:21rpx}.trip{display:flex;align-items:center;gap:18rpx;margin-top:16rpx;padding:24rpx;border-radius:24rpx;background:#fffdf7}.pin{font-size:39rpx}.trip-info{min-width:0;flex:1}.trip-title{font-size:29rpx;color:#465a49}.trip-sub{margin-top:7rpx;color:#909c91;font-size:21rpx}.state{padding:9rpx 12rpx;border-radius:99rpx;background:#e2f0df;color:#5a8160;font-size:20rpx}.empty{padding:75rpx 0;text-align:center;color:#87988a;font-size:25rpx}.new,.save{margin-top:28rpx;padding:25rpx;border-radius:24rpx;background:#69a778;color:#fff;text-align:center;font-size:27rpx}.editor{margin-top:20rpx;padding:22rpx;border-radius:24rpx;background:#fff}.input{box-sizing:border-box;width:100%;margin-top:12rpx;padding:19rpx;border:2rpx solid #e3ebe2;border-radius:15rpx;background:#fff;font-size:24rpx;color:#58675a}.date-row{display:grid;grid-template-columns:1fr 1fr;gap:12rpx}.save{margin-top:18rpx}
</style>
