<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { getRecipes, publishRecipe, type RecipeDraft } from '../../data/meal-draft';

type ViewName = 'order' | 'recipes' | 'menu';
const active = ref<ViewName>('order');
const mealTypes = ['早餐', '午餐', '晚餐', '加餐'];
const mealType = ref('晚餐');
const date = ref('2026-08-28');
const recipes = ref<RecipeDraft[]>([]);
const selected = ref<string[]>([]);
const category = ref('全部');
const categories = computed(() => ['全部', ...new Set(recipes.value.map((recipe) => recipe.category))]);
const visibleRecipes = computed(() => category.value === '全部' ? recipes.value.filter((recipe) => recipe.status === 'PUBLISHED') : recipes.value.filter((recipe) => recipe.status === 'PUBLISHED' && recipe.category === category.value));
const selectedRecipes = computed(() => recipes.value.filter((recipe) => selected.value.includes(recipe.id)));
const ingredientSummary = computed(() => {
  const map = new Map<string, { name: string; quantity: number; unit: string }>();
  for (const recipe of selectedRecipes.value) for (const item of recipe.ingredients) {
    const mapKey = item.name + ':' + item.unit;
    const existing = map.get(mapKey) ?? { name: item.name, quantity: 0, unit: item.unit };
    existing.quantity += Number(item.quantity) || 0;
    map.set(mapKey, existing);
  }
  return [...map.values()];
});
function loadRecipes() { recipes.value = getRecipes(); }
function toggleRecipe(recipeId: string) { selected.value = selected.value.includes(recipeId) ? selected.value.filter((id) => id !== recipeId) : [...selected.value, recipeId]; }
function openMenu() { active.value = 'menu'; }
function addRecipe() { uni.navigateTo({ url: '/pages/recipe-editor/index' }); }
function publish(recipeId: string) { publishRecipe(recipeId); loadRecipes(); }
function confirmShopping() { uni.showToast({ title: '缺少项将在确认后加入购物清单', icon: 'none' }); }
onShow(loadRecipes);
</script>

<template>
  <view class="page">
    <view class="heading"><text class="label">吃什么</text><text class="title">{{ active === 'order' ? '去点餐' : active === 'recipes' ? '菜谱' : '待做菜单' }}</text></view>
    <view class="tabs"><view class="tab" :class="{ selected: active === 'order' }" @tap="active = 'order'">去点餐</view><view class="tab" :class="{ selected: active === 'recipes' }" @tap="active = 'recipes'">菜谱</view><view class="tab" :class="{ selected: active === 'menu' }" @tap="openMenu">待做菜单<text v-if="selected.length">({{ selected.length }})</text></view></view>

    <view v-if="active === 'order'">
      <view class="picker-row"><view><text class="field-label">日期</text><text class="field-value">{{ date }}</text></view><view><text class="field-label">餐次</text><view class="meal-types"><text v-for="item in mealTypes" :key="item" class="meal-type" :class="{ chosen: mealType === item }" @tap="mealType = item">{{ item }}</text></view></view></view>
      <scroll-view class="categories" scroll-x><text v-for="item in categories" :key="item" class="category" :class="{ chosen: category === item }" @tap="category = item">{{ item }}</text></scroll-view>
      <view v-for="recipe in visibleRecipes" :key="recipe.id" class="recipe-card" @tap="toggleRecipe(recipe.id)"><view class="recipe-icon">🍽️</view><view><text class="recipe-name">{{ recipe.name }}</text><text class="recipe-meta">{{ recipe.category }} · {{ recipe.ingredients.map((item) => item.name).join('、') }}</text></view><text class="add" :class="{ added: selected.includes(recipe.id) }">{{ selected.includes(recipe.id) ? '已加入' : '加入餐单' }}</text></view>
      <view class="primary" @tap="openMenu">查看待做菜单（{{ selected.length }}）</view>
    </view>

    <view v-else-if="active === 'recipes'">
      <view class="recipe-actions"><text>已发布 {{ recipes.filter((recipe) => recipe.status === 'PUBLISHED').length }} 道</text><text class="new-recipe" @tap="addRecipe">＋ 添加菜谱</text></view>
      <view v-for="recipe in recipes" :key="recipe.id" class="recipe-card"><view class="recipe-icon">📖</view><view><text class="recipe-name">{{ recipe.name }}</text><text class="recipe-meta">{{ recipe.category }} · {{ recipe.ingredients.length }} 种食材 · {{ recipe.seasonings.length }} 种调料</text></view><text v-if="recipe.status === 'DRAFT'" class="publish" @tap.stop="publish(recipe.id)">发布</text><text v-else class="status">已发布</text></view>
      <view class="hint">只有厨师或管理员可以添加、编辑和发布菜谱。</view>
    </view>

    <view v-else>
      <view class="meal-summary"><text>{{ date }} {{ mealType }}</text><text>{{ selectedRecipes.length }} 道菜</text></view>
      <view v-if="!selectedRecipes.length" class="empty"><text>还没有选择菜品</text><view class="back" @tap="active = 'order'">去点餐</view></view>
      <view v-for="recipe in selectedRecipes" :key="recipe.id" class="menu-item"><text>{{ recipe.name }}</text><text @tap="toggleRecipe(recipe.id)">移除</text></view>
      <view v-if="ingredientSummary.length" class="ingredients"><text class="block-title">食材清单</text><view v-for="item in ingredientSummary" :key="item.name + item.unit" class="ingredient-row"><text>{{ item.name }}</text><text>{{ item.quantity }} {{ item.unit }}</text><text class="unknown">待对照库存</text></view></view>
      <view v-if="selectedRecipes.length" class="primary" @tap="confirmShopping">对照库存并确认缺少项</view>
    </view>
  </view>
</template>

<style scoped>
.page{min-height:100vh;padding:36rpx 28rpx 48rpx;background:#fff7e9}.label,.title,.field-label,.field-value,.recipe-name,.recipe-meta,.block-title{display:block}.label{font-size:23rpx;letter-spacing:3rpx;color:#9a7746}.title{margin-top:8rpx;font-size:42rpx;font-weight:700;color:#55452f}.tabs{display:flex;margin:28rpx 0 22rpx;padding:7rpx;border-radius:20rpx;background:#f5e8d0}.tab{flex:1;padding:16rpx 4rpx;border-radius:15rpx;text-align:center;color:#876f50;font-size:24rpx}.tab.selected{background:#fffdf8;color:#5c472e;font-weight:600}.picker-row{display:flex;justify-content:space-between;padding:24rpx;border-radius:24rpx;background:#fffdf8}.field-label{font-size:20rpx;color:#a49788}.field-value{margin-top:8rpx;font-size:28rpx;color:#4e463c}.meal-types{display:flex;gap:9rpx;margin-top:8rpx}.meal-type{padding:7rpx 11rpx;border-radius:99rpx;background:#f1ece4;color:#8b8378;font-size:20rpx}.meal-type.chosen{background:#f7d99a;color:#795321}.categories{white-space:nowrap;margin:22rpx 0}.category{display:inline-block;margin-right:12rpx;padding:12rpx 20rpx;border-radius:99rpx;background:#fffdf8;color:#837668;font-size:23rpx}.category.chosen{background:#dfb96c;color:#fff}.recipe-card{display:flex;align-items:center;gap:16rpx;margin-top:15rpx;padding:22rpx;border-radius:24rpx;background:#fffdf8}.recipe-icon{display:flex;align-items:center;justify-content:center;width:66rpx;height:66rpx;border-radius:20rpx;background:#fbe4b4;font-size:31rpx}.recipe-name{font-size:28rpx;color:#54483b}.recipe-meta{max-width:360rpx;margin-top:7rpx;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:20rpx;color:#a09382}.add,.status,.publish{margin-left:auto;padding:10rpx 14rpx;border-radius:99rpx;color:#967d5b;font-size:21rpx}.add{border:2rpx solid #dec497}.add.added{border-color:#71a57a;background:#e1f0df;color:#4f8058}.status{background:#e2f0df;color:#54825c}.publish{background:#f6ddb0;color:#8c5c20}.primary{margin-top:28rpx;padding:25rpx;border-radius:24rpx;background:#d99c48;color:#fff;text-align:center;font-size:28rpx}.recipe-actions{display:flex;justify-content:space-between;align-items:center;padding:20rpx 4rpx;color:#8b7b68;font-size:23rpx}.new-recipe{padding:12rpx 16rpx;border-radius:16rpx;background:#d99c48;color:#fff}.hint{margin-top:25rpx;color:#968c80;font-size:21rpx;line-height:1.6}.meal-summary{display:flex;justify-content:space-between;margin-bottom:15rpx;padding:23rpx;border-radius:22rpx;background:#fff0cd;color:#765328;font-size:25rpx}.menu-item,.ingredient-row{display:flex;justify-content:space-between;padding:22rpx;border-bottom:1rpx solid #eee5d6;background:#fffdf8;color:#574d42;font-size:25rpx}.menu-item:first-of-type{border-radius:20rpx 20rpx 0 0}.ingredients{margin-top:24rpx;border-radius:20rpx;overflow:hidden}.block-title{padding:20rpx;background:#f5ead4;color:#785b35;font-size:25rpx}.ingredient-row{font-size:23rpx}.unknown{color:#9b9387}.empty{margin-top:80rpx;text-align:center;color:#8f867a;font-size:27rpx}.back{display:inline-block;margin-top:24rpx;padding:17rpx 30rpx;border-radius:18rpx;background:#d99c48;color:white}
</style>
