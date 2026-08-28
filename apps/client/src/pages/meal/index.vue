<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { addMealRecipe, completeMeal, createMeal, importMealShortages, listMeals, listRecipes, recalculateMeal, removeMealRecipe, updateRecipeStatus, type IngredientComparison, type Meal, type Recipe } from '../../services/family-api';
import { ensureSession, type HouseholdContext } from '../../services/session';

type ViewName = 'order' | 'recipes' | 'menu';
const active = ref<ViewName>('order');
const mealTypes = ['早餐', '午餐', '晚餐', '加餐'];
const mealType = ref('晚餐');
const date = ref(today());
const recipes = ref<Recipe[]>([]);
const meal = ref<Meal>();
const comparison = ref<IngredientComparison[]>([]);
const checkedShortages = ref<string[]>([]);
const category = ref('全部');
const loading = ref(false);
const session = ref<HouseholdContext>();

const categories = computed(() => ['全部', ...new Set(recipes.value.map((recipe) => recipe.category?.name).filter((name): name is string => Boolean(name)))]);
const visibleRecipes = computed(() => recipes.value.filter((recipe) => recipe.status === 'PUBLISHED' && (category.value === '全部' || recipe.category?.name === category.value)));
const mealItems = computed(() => meal.value?.items ?? []);
const selectedRecipeIds = computed(() => new Set(mealItems.value.map((item) => item.recipeId)));
const ownRecipeIds = computed(() => new Set(mealItems.value.filter((item) => item.addedById === session.value?.membershipId).map((item) => item.recipeId)));

function today() { const value = new Date(); return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`; }
function dayRange(day: string) { return { from: `${day}T00:00:00+08:00`, to: `${day}T23:59:59+08:00` }; }
function scheduledAt() { const hour = ({ 早餐: '08', 午餐: '12', 晚餐: '18', 加餐: '21' } as Record<string, string>)[mealType.value] ?? '18'; return `${date.value}T${hour}:00:00+08:00`; }
function message(error: unknown) { return error instanceof Error ? error.message : '操作失败'; }
function formatQuantity(value: number | null) { return value === null ? '未填写' : String(Number(value.toFixed(3))); }

async function loadRecipesFromDatabase() { recipes.value = await listRecipes(); }
async function loadMealFromDatabase() {
  const range = dayRange(date.value);
  const meals = await listMeals(range.from, range.to);
  meal.value = meals.find((item) => item.mealType === mealType.value);
  comparison.value = meal.value ? await recalculateMeal(meal.value.id) : [];
  checkedShortages.value = comparison.value.filter((item) => item.status === 'SHORTAGE' && item.shortage !== null).map((item) => item.ingredientId + ':' + item.unit);
}
async function loadPage() {
  loading.value = true;
  try { session.value = await ensureSession(); await Promise.all([loadRecipesFromDatabase(), loadMealFromDatabase()]); }
  catch (error) { uni.showToast({ title: message(error), icon: 'none', duration: 3000 }); }
  finally { loading.value = false; }
}
async function changeDate(event: { detail: { value: string } }) { date.value = event.detail.value; await loadMealFromDatabase(); }
async function chooseMealType(value: string) { mealType.value = value; await loadMealFromDatabase(); }
async function ensureMeal() {
  if (meal.value) return meal.value;
  meal.value = { ...(await createMeal({ scheduledAt: scheduledAt(), mealType: mealType.value })), items: [] };
  return meal.value;
}
async function toggleRecipe(recipeId: string) {
  if (loading.value) return;
  loading.value = true;
  try {
    const current = await ensureMeal();
    if (ownRecipeIds.value.has(recipeId)) await removeMealRecipe(current.id, recipeId);
    else await addMealRecipe(current.id, recipeId);
    await loadMealFromDatabase();
  } catch (error) { uni.showToast({ title: message(error), icon: 'none' }); }
  finally { loading.value = false; }
}
function openMenu() { active.value = 'menu'; }
function addRecipe() { uni.navigateTo({ url: '/pages/recipe-editor/index' }); }
async function publish(recipeId: string) {
  try { await updateRecipeStatus(recipeId, 'PUBLISHED'); await loadRecipesFromDatabase(); uni.showToast({ title: '已发布', icon: 'success' }); }
  catch (error) { uni.showToast({ title: message(error), icon: 'none' }); }
}
function toggleShortage(item: IngredientComparison) {
  if (item.status !== 'SHORTAGE' || item.shortage === null) return;
  const key = item.ingredientId + ':' + item.unit;
  checkedShortages.value = checkedShortages.value.includes(key) ? checkedShortages.value.filter((value) => value !== key) : [...checkedShortages.value, key];
}
async function confirmShopping() {
  if (!meal.value) return;
  const items = comparison.value.filter((item) => checkedShortages.value.includes(item.ingredientId + ':' + item.unit) && item.shortage !== null).map((item) => ({ ingredientId: item.ingredientId, quantity: item.shortage!, unit: item.unit }));
  if (!items.length) { uni.showToast({ title: '请先勾选确定要购买的缺料', icon: 'none' }); return; }
  try { await importMealShortages(meal.value.id, items); uni.showToast({ title: '已加入购物清单', icon: 'success' }); }
  catch (error) { uni.showToast({ title: message(error), icon: 'none' }); }
}
function finishCooking() {
  if (!meal.value) return;
  uni.showModal({ title: '完成烹饪', content: '是否同时按菜谱用量扣减家中库存？', confirmText: '扣减库存', cancelText: '仅完成', success: async (result) => {
    try { await completeMeal(meal.value!.id, result.confirm); await loadMealFromDatabase(); uni.showToast({ title: '餐单已完成', icon: 'success' }); }
    catch (error) { uni.showToast({ title: message(error), icon: 'none' }); }
  } });
}

onShow(loadPage);
</script>

<template>
  <view class="page">
    <view class="heading"><text class="label">吃什么</text><text class="title">{{ active === 'order' ? '去点餐' : active === 'recipes' ? '菜谱' : '待做菜单' }}</text></view>
    <view class="tabs"><view class="tab" :class="{ selected: active === 'order' }" @tap="active = 'order'">去点餐</view><view class="tab" :class="{ selected: active === 'recipes' }" @tap="active = 'recipes'">菜谱</view><view class="tab" :class="{ selected: active === 'menu' }" @tap="openMenu">待做菜单<text v-if="mealItems.length">({{ mealItems.length }})</text></view></view>

    <view v-if="active === 'order'">
      <view class="picker-row"><view><text class="field-label">日期</text><picker mode="date" :value="date" @change="changeDate"><text class="field-value">{{ date }}　›</text></picker></view><view><text class="field-label">餐次</text><view class="meal-types"><text v-for="item in mealTypes" :key="item" class="meal-type" :class="{ chosen: mealType === item }" @tap="chooseMealType(item)">{{ item }}</text></view></view></view>
      <scroll-view class="categories" scroll-x><text v-for="item in categories" :key="item" class="category" :class="{ chosen: category === item }" @tap="category = item">{{ item }}</text></scroll-view>
      <view v-if="!loading && !visibleRecipes.length" class="empty"><text>还没有已发布的菜谱</text><view class="back" @tap="addRecipe">添加第一道菜</view></view>
      <view v-for="recipe in visibleRecipes" :key="recipe.id" class="recipe-card" @tap="toggleRecipe(recipe.id)"><view class="recipe-icon">🍽️</view><view class="recipe-info"><text class="recipe-name">{{ recipe.name }}</text><text class="recipe-meta">{{ recipe.category?.name || '未分类' }} · {{ recipe.ingredients.map((item) => item.ingredient.name).join('、') }}</text></view><text class="add" :class="{ added: selectedRecipeIds.has(recipe.id) }">{{ ownRecipeIds.has(recipe.id) ? '已点' : selectedRecipeIds.has(recipe.id) ? '家人已点' : '点这道菜' }}</text></view>
      <view class="primary" @tap="openMenu">查看待做菜单（{{ mealItems.length }}）</view>
    </view>

    <view v-else-if="active === 'recipes'">
      <view class="recipe-actions"><text>数据库中 {{ recipes.length }} 道菜谱</text><text class="new-recipe" @tap="addRecipe">＋ 添加菜谱</text></view>
      <view v-if="!loading && !recipes.length" class="empty"><text>还没有菜谱</text></view>
      <view v-for="recipe in recipes" :key="recipe.id" class="recipe-card"><view class="recipe-icon">📖</view><view class="recipe-info"><text class="recipe-name">{{ recipe.name }}</text><text class="recipe-meta">{{ recipe.category?.name || '未分类' }} · {{ recipe.ingredients.length }} 种食材 · {{ recipe.seasonings.length }} 种调料</text></view><text v-if="recipe.status === 'DRAFT'" class="publish" @tap.stop="publish(recipe.id)">发布</text><text v-else class="status">{{ recipe.status === 'PUBLISHED' ? '已发布' : '已归档' }}</text></view>
      <view class="hint">厨师或管理员可以添加、编辑和发布菜谱。</view>
    </view>

    <view v-else>
      <view class="meal-summary"><text>{{ date }} {{ mealType }}</text><text>{{ mealItems.length }} 道菜 · {{ meal?.status === 'COMPLETED' ? '已完成' : '待制作' }}</text></view>
      <view v-if="!mealItems.length" class="empty"><text>还没有选择菜品</text><view class="back" @tap="active = 'order'">去点餐</view></view>
      <view v-for="item in mealItems" :key="item.id" class="menu-item"><text>{{ item.recipe.name }}</text><text class="person">{{ item.addedById === session?.membershipId ? '我添加的' : '家人添加的' }}</text></view>
      <view v-if="comparison.length" class="ingredients"><text class="block-title">食材与库存对照</text><view v-for="item in comparison" :key="item.ingredientId + item.unit" class="ingredient-row" :class="item.status.toLowerCase()" @tap="toggleShortage(item)"><text class="check">{{ checkedShortages.includes(item.ingredientId + ':' + item.unit) ? '✓' : '' }}</text><view class="ingredient-name"><text>{{ item.name }}</text><text class="amount-text">需要 {{ formatQuantity(item.required) }} {{ item.unit }} · 库存 {{ formatQuantity(item.onHand) }} {{ item.unit }}</text></view><text class="stock-status">{{ item.status === 'SHORTAGE' ? `缺 ${formatQuantity(item.shortage)} ${item.unit}` : item.status === 'SUFFICIENT' ? '充足' : '待确认' }}</text></view></view>
      <view v-if="comparison.some((item) => item.status === 'SHORTAGE')" class="primary" @tap="confirmShopping">确认勾选缺料并加入购物清单</view>
      <view v-if="mealItems.length && meal?.status !== 'COMPLETED'" class="secondary" @tap="finishCooking">完成烹饪</view>
    </view>
  </view>
</template>

<style scoped>
.page{min-height:100vh;padding:36rpx 28rpx 48rpx;background:#fff7e9}.label,.title,.field-label,.field-value,.recipe-name,.recipe-meta,.block-title,.amount-text{display:block}.label{font-size:23rpx;letter-spacing:3rpx;color:#9a7746}.title{margin-top:8rpx;font-size:42rpx;font-weight:700;color:#55452f}.tabs{display:flex;margin:28rpx 0 22rpx;padding:7rpx;border-radius:20rpx;background:#f5e8d0}.tab{flex:1;padding:16rpx 4rpx;border-radius:15rpx;text-align:center;color:#876f50;font-size:24rpx}.tab.selected{background:#fffdf8;color:#5c472e;font-weight:600}.picker-row{display:flex;justify-content:space-between;padding:24rpx;border-radius:24rpx;background:#fffdf8}.field-label{font-size:20rpx;color:#a49788}.field-value{margin-top:8rpx;font-size:28rpx;color:#4e463c}.meal-types{display:flex;gap:9rpx;margin-top:8rpx}.meal-type{padding:7rpx 11rpx;border-radius:99rpx;background:#f1ece4;color:#8b8378;font-size:20rpx}.meal-type.chosen{background:#f7d99a;color:#795321}.categories{white-space:nowrap;margin:22rpx 0}.category{display:inline-block;margin-right:12rpx;padding:12rpx 20rpx;border-radius:99rpx;background:#fffdf8;color:#837668;font-size:23rpx}.category.chosen{background:#dfb96c;color:#fff}.recipe-card{display:flex;align-items:center;gap:16rpx;margin-top:15rpx;padding:22rpx;border-radius:24rpx;background:#fffdf8}.recipe-icon{display:flex;align-items:center;justify-content:center;width:66rpx;height:66rpx;border-radius:20rpx;background:#fbe4b4;font-size:31rpx}.recipe-info{min-width:0;flex:1}.recipe-name{font-size:28rpx;color:#54483b}.recipe-meta{max-width:100%;margin-top:7rpx;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:20rpx;color:#a09382}.add,.status,.publish{flex:none;margin-left:auto;padding:10rpx 14rpx;border-radius:99rpx;color:#967d5b;font-size:21rpx}.add{border:2rpx solid #dec497}.add.added{border-color:#71a57a;background:#e1f0df;color:#4f8058}.status{background:#e2f0df;color:#54825c}.publish{background:#f6ddb0;color:#8c5c20}.primary,.secondary{margin-top:28rpx;padding:25rpx;border-radius:24rpx;text-align:center;font-size:28rpx}.primary{background:#d99c48;color:#fff}.secondary{border:2rpx solid #d99c48;color:#9b6525}.recipe-actions{display:flex;justify-content:space-between;align-items:center;padding:20rpx 4rpx;color:#8b7b68;font-size:23rpx}.new-recipe{padding:12rpx 16rpx;border-radius:16rpx;background:#d99c48;color:#fff}.hint{margin-top:25rpx;color:#968c80;font-size:21rpx;line-height:1.6}.meal-summary{display:flex;justify-content:space-between;margin-bottom:15rpx;padding:23rpx;border-radius:22rpx;background:#fff0cd;color:#765328;font-size:25rpx}.menu-item,.ingredient-row{display:flex;align-items:center;justify-content:space-between;padding:22rpx;border-bottom:1rpx solid #eee5d6;background:#fffdf8;color:#574d42;font-size:25rpx}.person{color:#9b8e7e;font-size:21rpx}.ingredients{margin-top:24rpx;border-radius:20rpx;overflow:hidden}.block-title{padding:20rpx;background:#f5ead4;color:#785b35;font-size:25rpx}.ingredient-row{gap:14rpx;font-size:23rpx}.ingredient-row.shortage{background:#fff1ec}.ingredient-row.sufficient{background:#f1f8ee}.check{display:flex;align-items:center;justify-content:center;width:34rpx;height:34rpx;border:2rpx solid #d6b58c;border-radius:10rpx;color:#c47639}.ingredient-name{min-width:0;flex:1}.amount-text{margin-top:5rpx;color:#9b9387;font-size:19rpx}.stock-status{flex:none;color:#b06a3e;font-size:21rpx}.sufficient .stock-status{color:#5f8b63}.empty{margin-top:80rpx;text-align:center;color:#8f867a;font-size:27rpx}.back{display:inline-block;margin-top:24rpx;padding:17rpx 30rpx;border-radius:18rpx;background:#d99c48;color:white}
</style>
