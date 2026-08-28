<script setup lang="ts">
import { ref } from 'vue';
import { saveRecipe } from '../../data/meal-draft';

const name = ref('');
const category = ref('炒菜');
const categories = ['主食', '炒菜', '炖菜', '海鲜', '汤羹', '其他'];
const ingredients = ref([{ name: '', quantity: '', unit: 'g' }]);
const seasonings = ref(['']);
const steps = ref(['']);
function addIngredient() { ingredients.value.push({ name: '', quantity: '', unit: 'g' }); }
function addSeasoning() { seasonings.value.push(''); }
function addStep() { steps.value.push(''); }
function save() {
  if (!name.value.trim() || ingredients.value.some((item) => !item.name.trim() || !item.unit.trim()) || steps.value.some((item) => !item.trim())) {
    uni.showToast({ title: '请填写菜名、食材和做法', icon: 'none' }); return;
  }
  saveRecipe({ id: 'local-' + Date.now(), name: name.value.trim(), category: category.value, ingredients: ingredients.value.filter((item) => item.name.trim()), seasonings: seasonings.value.filter(Boolean), steps: steps.value.filter(Boolean), status: 'DRAFT' });
  uni.showToast({ title: '菜谱草稿已保存', icon: 'success' });
  setTimeout(() => uni.navigateBack(), 600);
}
</script>
<template><view class="page"><view class="section"><text class="title">基本信息</text><input v-model="name" class="input" placeholder="菜名" /><picker :range="categories" @change="category = categories[Number($event.detail.value)]"><view class="input picker">{{ category }}　›</view></picker></view><view class="section"><text class="title">食材</text><view v-for="(item,index) in ingredients" :key="index" class="row"><input v-model="item.name" class="input short" placeholder="食材" /><input v-model="item.quantity" class="input amount" placeholder="数量" /><input v-model="item.unit" class="input unit" placeholder="单位" /></view><text class="add" @tap="addIngredient">＋ 添加食材</text></view><view class="section"><text class="title">调料（不填用量）</text><input v-for="(_,index) in seasonings" :key="index" v-model="seasonings[index]" class="input" placeholder="调料名称" /><text class="add" @tap="addSeasoning">＋ 添加调料</text></view><view class="section"><text class="title">做法</text><textarea v-for="(_,index) in steps" :key="index" v-model="steps[index]" class="textarea" :placeholder="'步骤 ' + (index + 1)" /><text class="add" @tap="addStep">＋ 添加步骤</text></view><view class="save" @tap="save">保存草稿</view></view></template>
<style scoped>.page{min-height:100vh;padding:26rpx 28rpx 48rpx;background:#f8f4ec}.section{margin-bottom:20rpx;padding:24rpx;border-radius:24rpx;background:#fffdf8}.title{display:block;margin-bottom:16rpx;font-size:29rpx;font-weight:600;color:#5a4e40}.input,.textarea{box-sizing:border-box;width:100%;margin-top:12rpx;padding:18rpx;border:2rpx solid #eee4d7;border-radius:15rpx;background:#fff;font-size:25rpx}.picker{color:#555}.row{display:flex;gap:10rpx}.short{width:42%}.amount{width:30%}.unit{width:28%}.textarea{height:120rpx}.add{display:inline-block;margin-top:18rpx;color:#b47831;font-size:24rpx}.save{margin-top:32rpx;padding:25rpx;border-radius:24rpx;background:#d99c48;color:#fff;text-align:center;font-size:29rpx}</style>
