<script setup lang="ts">
const modules = [
  { title: '今天吃什么', subtitle: '点餐与待做菜单', icon: '🍲' },
  { title: '购物清单', subtitle: '下次超市要买什么', icon: '🛒' },
  { title: '露营出行', subtitle: '行程、装备和照片', icon: '⛺' },
  { title: '家庭日历', subtitle: '餐点、纪念日和待办', icon: '🗓️' },
];
</script>

<template>
  <view class="page">
    <view class="hero"><text class="greeting">家庭生活</text><text class="caption">让每一件小事都有着落</text></view>
    <view class="grid"><view v-for="item in modules" :key="item.title" class="card"><text class="icon">{{ item.icon }}</text><view><text class="title">{{ item.title }}</text><text class="subtitle">{{ item.subtitle }}</text></view></view></view>
  </view>
</template>

<style scoped>
.page { padding: 32rpx; }.hero { padding: 36rpx 12rpx 28rpx; }.greeting,.title,.subtitle,.caption { display:block; }.greeting { font-size: 52rpx; font-weight: 700; }.caption { margin-top: 12rpx; color:#718096; font-size:28rpx; }.grid { display:grid; grid-template-columns:1fr 1fr; gap:24rpx; }.card { background:#fff; border-radius:24rpx; min-height:190rpx; padding:26rpx; box-sizing:border-box; box-shadow:0 8rpx 24rpx rgba(40,55,75,.06); }.icon { display:block; font-size:44rpx; margin-bottom:20rpx; }.title { font-size:30rpx; font-weight:600; }.subtitle { margin-top:8rpx; color:#8b95a5; font-size:23rpx; line-height:1.4; }
</style>

