<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { createRecipe, listRecipeCategories, type RecipeCategory } from '../../services/family-api';

const name = ref('');
const categories = ref<RecipeCategory[]>([]);
const categoryIndex = ref(0);
const ingredients = ref([{ name: '', quantity: '', unit: 'g' }]);
const seasonings = ref(['']);
const steps = ref(['']);
const saving = ref(false);
const categoryName = computed(() => categories.value[categoryIndex.value]?.name ?? '请选择分类');

function message(error: unknown) { return error instanceof Error ? error.message : '操作失败'; }
function addIngredient() { ingredients.value.push({ name: '', quantity: '', unit: 'g' }); }
function removeIngredient(index: number) { if (ingredients.value.length > 1) ingredients.value.splice(index, 1); }
function addSeasoning() { seasonings.value.push(''); }
function addStep() { steps.value.push(''); }
function removeStep(index: number) { if (steps.value.length > 1) steps.value.splice(index, 1); }

async function loadCategories() {
  try { categories.value = await listRecipeCategories(); }
  catch (error) { uni.showToast({ title: message(error), icon: 'none' }); }
}

async function save() {
  const cleanIngredients = ingredients.value.filter((item) => item.name.trim());
  const cleanSteps = steps.value.map((item) => item.trim()).filter(Boolean);
  if (!name.value.trim() || !categories.value.length || !cleanIngredients.length || cleanIngredients.some((item) => !item.unit.trim()) || !cleanSteps.length) {
    uni.showToast({ title: '请填写菜名、分类、食材和做法', icon: 'none' }); return;
  }
  saving.value = true;
  try {
    await createRecipe({
      name: name.value.trim(),
      categoryId: categories.value[categoryIndex.value].id,
      ingredients: cleanIngredients.map((item) => ({ name: item.name.trim(), quantity: item.quantity === '' ? undefined : Number(item.quantity), unit: item.unit.trim() })),
      seasonings: seasonings.value.map((item) => item.trim()).filter(Boolean),
      steps: cleanSteps,
    });
    uni.showToast({ title: '菜谱草稿已保存', icon: 'success' });
    setTimeout(() => uni.navigateBack(), 500);
  } catch (error) { uni.showToast({ title: message(error), icon: 'none' }); }
  finally { saving.value = false; }
}

onLoad(loadCategories);
</script>

<template>
  <view class="page">
    <view class="section"><text class="title">基本信息</text><input v-model="name" class="input" placeholder="菜名" /><picker :range="categories" range-key="name" @change="categoryIndex = Number($event.detail.value)"><view class="input picker">{{ categoryName }}　›</view></picker></view>
    <view class="section"><text class="title">食材</text><view v-for="(item,index) in ingredients" :key="index" class="row"><input v-model="item.name" class="input short" placeholder="食材" /><input v-model="item.quantity" type="digit" class="input amount" placeholder="数量" /><input v-model="item.unit" class="input unit" placeholder="单位" /><text class="remove" @tap="removeIngredient(index)">×</text></view><text class="add" @tap="addIngredient">＋ 添加食材</text></view>
    <view class="section"><text class="title">调料（不填用量）</text><input v-for="(_,index) in seasonings" :key="index" v-model="seasonings[index]" class="input" placeholder="调料名称" /><text class="add" @tap="addSeasoning">＋ 添加调料</text></view>
    <view class="section"><text class="title">做法</text><view v-for="(_,index) in steps" :key="index" class="step"><textarea v-model="steps[index]" class="textarea" :placeholder="'步骤 ' + (index + 1)" /><text class="remove step-remove" @tap="removeStep(index)">×</text></view><text class="add" @tap="addStep">＋ 添加步骤</text></view>
    <view class="save" :class="{ disabled: saving }" @tap="save">{{ saving ? '保存中…' : '保存草稿' }}</view>
  </view>
</template>

<style scoped>
.page{min-height:100vh;padding:26rpx 28rpx 48rpx;background:#f8f4ec}.section{margin-bottom:20rpx;padding:24rpx;border-radius:24rpx;background:#fffdf8}.title{display:block;margin-bottom:16rpx;font-size:29rpx;font-weight:600;color:#5a4e40}.input,.textarea{box-sizing:border-box;width:100%;margin-top:12rpx;padding:18rpx;border:2rpx solid #eee4d7;border-radius:15rpx;background:#fff;font-size:25rpx}.picker{color:#555}.row{display:flex;align-items:center;gap:8rpx}.short{width:38%}.amount{width:25%}.unit{width:24%}.remove{padding:8rpx;color:#c48c75;font-size:34rpx}.step{position:relative}.step-remove{position:absolute;top:15rpx;right:7rpx}.textarea{height:120rpx;padding-right:55rpx}.add{display:inline-block;margin-top:18rpx;color:#b47831;font-size:24rpx}.save{margin-top:32rpx;padding:25rpx;border-radius:24rpx;background:#d99c48;color:#fff;text-align:center;font-size:29rpx}.disabled{opacity:.55}
</style>
