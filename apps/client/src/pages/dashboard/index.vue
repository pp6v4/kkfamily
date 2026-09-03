<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { getDashboardSummary, type DashboardSummary } from '../../services/family-api';
import { canAccess, refreshAccess, type HouseholdContext } from '../../services/session';

const session=ref<HouseholdContext>(),summary=ref<DashboardSummary>(),loading=ref(false),rangeIndex=ref(0);
const ranges=[{label:'近30天',days:30},{label:'近90天',days:90},{label:'近一年',days:365}];
const taskText=computed(()=>{const tasks=summary.value?.tasks;if(!tasks)return'';return tasks.total?`${tasks.completed} / ${tasks.total} · ${Math.round((tasks.completionRate||0)*100)}%`:'暂无任务';});
function message(error:unknown){return error instanceof Error?error.message:'读取看板失败';}
function dateRange(){const to=new Date();to.setHours(0,0,0,0);to.setDate(to.getDate()+1);const from=new Date(to);from.setDate(from.getDate()-ranges[rangeIndex.value].days);return{from:from.toISOString(),to:to.toISOString()};}
async function load(){loading.value=true;try{session.value=await refreshAccess();if(!canAccess(session.value,'dashboard'))return;const range=dateRange();summary.value=await getDashboardSummary(range.from,range.to);}catch(error){uni.showToast({title:message(error),icon:'none'});}finally{loading.value=false;}}
function changeRange(event:{detail:{value:string|number}}){rangeIndex.value=Number(event.detail.value);load();}
function open(source:'meals'|'shopping'|'trips'|'tasks'){if(source==='meals')uni.switchTab({url:'/pages/meal/index'});else if(source==='shopping')uni.switchTab({url:'/pages/shopping/index'});else if(source==='trips')uni.switchTab({url:'/pages/camping/index'});else uni.navigateTo({url:'/pages/tasks/index'});}
onShow(load);
</script>

<template>
  <view class="page">
    <view class="head"><view><text class="eyebrow">生活小看板</text><text class="title">看看最近的小日子</text></view><picker :range="ranges" range-key="label" :value="rangeIndex" @change="changeRange"><view class="range">{{ranges[rangeIndex].label}}⌄</view></picker></view>
    <text class="subtitle">只展示你有权查看的来源，不统计花费，也不比较谁做得多。</text>
    <text v-if="loading&&!summary" class="loading">正在整理家庭近况…</text>
    <view v-if="summary" class="grid">
      <view v-if="summary.recipes" class="metric recipe" @tap="open('meals')"><text class="icon">🍲</text><text class="number">{{summary.recipes.publishedCount}}</text><text class="label">已发布菜谱</text><text class="hint">去看看吃什么 ›</text></view>
      <view v-if="summary.meals" class="metric meal" @tap="open('meals')"><text class="icon">🥢</text><text class="number">{{summary.meals.completedCount}}</text><text class="label">完成餐次</text><text class="hint">按一餐计算 ›</text></view>
      <view v-if="summary.shopping" class="metric shop" @tap="open('shopping')"><text class="icon">🛒</text><text class="number">{{summary.shopping.pendingCount}}</text><text class="label">当前待购</text><text class="hint">购物袋与补货 ›</text></view>
      <view v-if="summary.trips" class="metric trip" @tap="open('trips')"><text class="icon">🏕️</text><text class="number">{{summary.trips.visibleTripCount}}</text><text class="label">可见行程</text><text class="hint">{{summary.trips.pendingPackingCount}} 件待准备 ›</text></view>
    </view>
    <view v-if="summary?.tasks" class="wide" @tap="open('tasks')"><view><text class="wide-title">家庭待办完成情况</text><text class="wide-note">已取消事项不进入分母</text></view><view class="task-value"><text>{{taskText}}</text><text class="go">›</text></view></view>
    <view v-if="summary?.meals?.frequentRecipes.length" class="wide list"><text class="wide-title">最近常选的菜</text><text class="wide-note">按完成餐次去重统计，不评价任何家庭成员</text><view v-for="(recipe,index) in summary.meals.frequentRecipes" :key="recipe.recipeId" class="recipe-row"><text><text class="rank">{{index+1}}</text>{{recipe.name}}</text><text>{{recipe.mealCount}} 餐</text></view></view>
    <view v-if="summary?.shopping" class="wide list"><text class="wide-title">待购组成</text><view class="shopping-row"><text>以后想买 {{summary.shopping.counts.WISHLIST}}</text><text>下次购买 {{summary.shopping.counts.NEXT_TRIP}}</text><text>需要补货 {{summary.shopping.counts.REPLENISH}}</text></view></view>
    <text class="foot">没有权限的模块会完全隐藏，不会用“0”代替别人的数据。</text>
  </view>
</template>

<style scoped>
.page{min-height:100vh;padding:36rpx 28rpx 70rpx;background:linear-gradient(180deg,#dfeef1,#f7f3e8 38%)}.head{display:flex;align-items:flex-start;justify-content:space-between}.eyebrow,.title,.subtitle,.loading,.icon,.number,.label,.hint,.wide-title,.wide-note,.foot{display:block}.eyebrow{color:#688f99;font-size:20rpx;letter-spacing:3rpx}.title{margin-top:8rpx;color:#405e65;font-size:40rpx;font-weight:700}.range{padding:13rpx 16rpx;border-radius:15rpx;background:rgba(255,255,255,.8);color:#5f7f87;font-size:21rpx}.subtitle{margin-top:12rpx;color:#87999d;font-size:21rpx;line-height:1.5}.loading{padding:90rpx 0;color:#87999d;text-align:center}.grid{display:grid;grid-template-columns:1fr 1fr;gap:13rpx;margin-top:25rpx}.metric{padding:22rpx;border:3rpx solid #fff;border-radius:25rpx;background:#fffdf8;box-shadow:0 8rpx 18rpx rgba(73,99,104,.06)}.metric.recipe{background:#fff8e2}.metric.meal{background:#f1f6e5}.metric.shop{background:#fbeee7}.metric.trip{background:#eaf3f4}.icon{font-size:32rpx}.number{margin-top:12rpx;color:#425c61;font-size:45rpx;font-weight:700}.label{margin-top:3rpx;color:#647579;font-size:22rpx}.hint{margin-top:12rpx;color:#94a0a2;font-size:18rpx}.wide{display:flex;align-items:center;justify-content:space-between;margin-top:14rpx;padding:23rpx;border:3rpx solid #fff;border-radius:24rpx;background:#fffdf8}.wide-title{color:#4f6266;font-size:26rpx;font-weight:650}.wide-note{margin-top:6rpx;color:#969fa0;font-size:18rpx}.task-value{display:flex;align-items:center;gap:12rpx;color:#60848d;font-size:25rpx}.go{font-size:35rpx}.wide.list{display:block}.recipe-row{display:flex;justify-content:space-between;padding:15rpx 0;border-bottom:1rpx solid #edf0ed;color:#697779;font-size:21rpx}.rank{display:inline-flex;align-items:center;justify-content:center;width:32rpx;height:32rpx;margin-right:12rpx;border-radius:11rpx;background:#e5efef;color:#66878d;font-size:17rpx}.shopping-row{display:flex;justify-content:space-between;margin-top:18rpx;color:#7d8583;font-size:19rpx}.foot{margin-top:30rpx;color:#9aa2a0;text-align:center;font-size:18rpx;line-height:1.55}
</style>
