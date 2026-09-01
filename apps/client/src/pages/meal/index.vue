<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { addMealRecipe, completeMeal, createMeal, importMealShortages, listMeals, listRecipes, recalculateMeal, removeMealRecipe, updateRecipeStatus, transitionMeal, updateMealDish, listMealSnapshots, mealTypeCodes, mealTypeLabel, type IngredientComparison, type Meal, type Recipe } from '../../services/family-api';
import { canAccess, refreshAccess, type HouseholdContext } from '../../services/session';
import { takeCalendarTarget } from '../../services/calendar-navigation';

type ViewName = 'order' | 'recipes' | 'menu';
const active = ref<ViewName>('order');
const mealTypes = ['早餐', '午餐', '晚餐', '加餐'];
const mealType = ref('晚餐'), slotKey = ref(''), targetMealId = ref<string>();
const date = ref(today()), recipes = ref<Recipe[]>([]), meal = ref<Meal>();
const comparison = ref<IngredientComparison[]>([]), checkedShortages = ref<string[]>([]);
const category = ref('全部'), loading = ref(false), errorText = ref('');
const session = ref<HouseholdContext>();
const servings = ref<Record<string, string>>({});
const reopenReason = ref('');
const history = ref<Awaited<ReturnType<typeof listMealSnapshots>>>([]);
const categories = computed(() => ['全部', ...new Set(recipes.value.map(r => r.category?.name).filter((n): n is string => Boolean(n)))]);
const visibleRecipes = computed(() => recipes.value.filter(r => r.status === 'PUBLISHED' && (category.value === '全部' || r.category?.name === category.value)));
const mealItems = computed(() => meal.value?.menu ?? []);
const selectedRecipeIds = computed(() => new Set(mealItems.value.map(i => i.recipeId)));
const ownRecipeIds = computed(() => new Set((meal.value?.items ?? []).filter(i => i.addedById === session.value?.membershipId).map(i => i.recipeId)));
const statusLabels = { DRAFT: '大家点菜中', CONFIRMED: '菜单已确认', COOKING: '烹饪中', COMPLETED: '已完成', CANCELLED: '已取消' };
const stockLabels: Record<string,string> = { SUFFICIENT:'充足', UNKNOWN:'待确认', PRESENT:'有', ABSENT:'无', NEEDS_CHECK:'请核实过期批次' };
function today() { return new Date(Date.now()+8*3600000).toISOString().slice(0,10); }
function dayRange(day: string) { const from=day+'T00:00:00+08:00'; return {from,to:new Date(new Date(from).getTime()+86400000).toISOString()}; }
function scheduledAt() { return date.value+'T'+(({早餐:'08',午餐:'12',晚餐:'18',加餐:'21'} as Record<string,string>)[mealType.value]??'18')+':00:00+08:00'; }
function message(error: unknown) { return error instanceof Error ? error.message : '操作失败'; }
function formatQuantity(value: string | number | null) { return value === null ? '待确认' : String(Number(value)); }
function fail(error: unknown) { errorText.value=message(error); uni.showToast({title:errorText.value,icon:'none'}); }
async function loadMealFromDatabase() {
  comparison.value=[]; checkedShortages.value=[]; history.value=[];
  if(!canAccess(session.value,'meals')) { meal.value=undefined; return; }
  const range=dayRange(date.value), meals=await listMeals(range.from,range.to);
  meal.value = targetMealId.value ? meals.find(m=>m.id===targetMealId.value) : meals.find(m=>m.mealType===mealTypeCodes[mealType.value] && m.slotKey===slotKey.value.trim());
  if(targetMealId.value && !meal.value) throw new Error('该餐点不存在或已经没有访问权限');
  if(meal.value) { mealType.value=mealTypeLabel(meal.value.mealType); slotKey.value=meal.value.slotKey; }
  servings.value=Object.fromEntries(mealItems.value.map(d=>[d.recipeId,String(Number(d.cookMultiplier))]));
  if(meal.value && !meal.value.legacyWithoutSnapshot && canAccess(session.value,'inventory')) comparison.value=await recalculateMeal(meal.value.id);
  checkedShortages.value=comparison.value.filter(i=>i.status==='SHORTAGE').map(i=>i.key);
}
async function loadPage() {
  const target=takeCalendarTarget('MEAL');
  if(target) { date.value=target.date; targetMealId.value=target.sourceId; if(target.mealType && mealTypes.includes(target.mealType))mealType.value=target.mealType; active.value='menu'; }
  loading.value=true; recipes.value=[]; meal.value=undefined; comparison.value=[]; session.value=undefined; errorText.value='';
  try { session.value=await refreshAccess(); await Promise.all([canAccess(session.value,'recipes')?listRecipes().then(r=>recipes.value=r):Promise.resolve(),loadMealFromDatabase()]); }
  catch(error) { recipes.value=[]; meal.value=undefined; comparison.value=[]; fail(error); }
  finally { loading.value=false; }
}
async function changeSelection(day: string, type: string) {
  if(loading.value)return; date.value=day; mealType.value=type; targetMealId.value=undefined; errorText.value=''; loading.value=true;
  try { await loadMealFromDatabase(); } catch(error){meal.value=undefined;comparison.value=[];fail(error);} finally{loading.value=false;}
}
function changeDate(event:{detail:{value:string}}) { return changeSelection(event.detail.value,mealType.value); }
function chooseMealType(type:string) { if(type!=='加餐')slotKey.value=''; return changeSelection(date.value,type); }
async function toggleRecipe(recipeId:string) {
  if(loading.value)return;
  if(!canAccess(session.value,'meals','EDIT')) { fail(new Error('没有点餐权限')); return; }
  loading.value=true; errorText.value='';
  try {
    if(!meal.value) meal.value=await createMeal({scheduledAt:scheduledAt(),mealType:mealTypeCodes[mealType.value],slotKey:slotKey.value.trim()||undefined});
    if(meal.value.status!=='DRAFT')throw new Error('餐单已锁定；需由厨师重新打开后点菜');
    if(ownRecipeIds.value.has(recipeId))await removeMealRecipe(meal.value.id,recipeId);else await addMealRecipe(meal.value.id,recipeId);
    await loadMealFromDatabase();
  } catch(error){fail(error);} finally{loading.value=false;}
}
function addRecipe() { uni.navigateTo({url:'/pages/recipe-editor/index'}); }
function editRecipe(id:string) { uni.navigateTo({url:'/pages/recipe-editor/index?id='+encodeURIComponent(id)}); }
async function publish(recipe:Recipe) { if(loading.value)return;loading.value=true;try{await updateRecipeStatus(recipe,'PUBLISHED');recipes.value=await listRecipes();}catch(error){fail(error);}finally{loading.value=false;} }
async function saveServings(recipeId:string) {
  if(!meal.value||loading.value)return;loading.value=true;errorText.value='';
  try { meal.value=await updateMealDish(meal.value,recipeId,Number(servings.value[recipeId]));await loadMealFromDatabase(); }
  catch(error){fail(error);}finally{loading.value=false;}
}
function confirmAction(action:'confirm'|'reopen'|'start'|'cancel') {
  const current=meal.value;if(!current||loading.value)return;
  if(action==='reopen'&&!reopenReason.value.trim()){fail(new Error('请填写重新打开餐单的原因'));return;}
  const titles={confirm:'确认本餐菜单',reopen:'重新打开菜单',start:'开始烹饪',cancel:'取消这顿餐点'};
  uni.showModal({title:titles[action],content:action==='confirm'?'按已保存份数锁定菜名和用料快照；普通点菜将停止。':action==='reopen'?'旧快照保留。重新确认时生成新版菜单，并记录原因。':'确认执行此操作？',success:async result=>{
    if(!result.confirm)return;loading.value=true;errorText.value='';
    try{meal.value=await transitionMeal(current,action,reopenReason.value.trim()||undefined);reopenReason.value='';await loadMealFromDatabase();}catch(error){fail(error);}finally{loading.value=false;}
  }});
}
function toggleShortage(item:IngredientComparison) { if(item.status!=='SHORTAGE')return; checkedShortages.value=checkedShortages.value.includes(item.key)?checkedShortages.value.filter(k=>k!==item.key):[...checkedShortages.value,item.key]; }
async function confirmShopping() {
  if(!meal.value||loading.value)return; if(!checkedShortages.value.length){fail(new Error('请先勾选要购买的缺料'));return;}
  loading.value=true;errorText.value='';
  try{await importMealShortages(meal.value,checkedShortages.value);uni.showToast({title:'已加入清单，重复提交不会加倍',icon:'none'});}catch(error){fail(error);}finally{loading.value=false;}
}
function finishCooking(){
  const current=meal.value;if(!current||loading.value)return;
  uni.showModal({title:'完成这顿饭',content:'只记录餐点已完成，不会自动减少任何库存。库存仍由家人按需要手工核实。',success:async result=>{
    if(!result.confirm)return;loading.value=true;errorText.value='';
    try{await completeMeal(current);await loadMealFromDatabase();uni.showToast({title:'餐点已完成',icon:'success'});}catch(error){fail(error);}finally{loading.value=false;}
  }});
}
async function showHistory(){if(!meal.value)return;try{history.value=await listMealSnapshots(meal.value.id);}catch(error){fail(error);}}
onShow(loadPage);
</script>
<template>
  <view class="page">
    <view class="heading"><text class="label">吃什么</text><text class="title">一起好好吃饭</text></view>
    <view class="tabs"><view class="tab" :class="{selected:active==='order'}" @tap="active='order'">去点餐</view><view class="tab" :class="{selected:active==='recipes'}" @tap="active='recipes'">菜谱</view><view class="tab" :class="{selected:active==='menu'}" @tap="active='menu'">待做菜单</view></view>
    <view v-if="errorText" class="error">{{errorText}}<text class="small-action" @tap="loadPage">刷新</text></view>
    <view v-if="loading" class="hint">正在同步家里的数据…</view>
    <view v-if="active!=='recipes'" class="picker-row"><picker mode="date" :value="date" @change="changeDate"><text class="field-value">{{date}} ›</text></picker><view class="meal-types"><text v-for="item in mealTypes" :key="item" class="meal-type" :class="{chosen:mealType===item}" @tap="chooseMealType(item)">{{item}}</text></view></view>
    <view v-if="active!=='recipes' && mealType==='加餐'" class="form-box"><input v-model="slotKey" class="entry" placeholder="加餐名称，可留空；如下午茶" /><button @tap="changeSelection(date,mealType)">查看这顿加餐</button></view>
    <view v-if="active==='order'">
      <view v-if="!canAccess(session,'recipes')" class="empty">尚未获得菜谱访问权限</view>
      <scroll-view class="categories" scroll-x><text v-for="item in categories" :key="item" class="category" :class="{chosen:category===item}" @tap="category=item">{{item}}</text></scroll-view>
      <view v-if="meal && meal.status!=='DRAFT'" class="hint">{{statusLabels[meal.status]}}，普通点菜已停止。</view>
      <view v-if="!loading && !visibleRecipes.length" class="empty">还没有已发布菜谱</view>
      <view v-for="recipe in visibleRecipes" :key="recipe.id" class="recipe-card"><view class="recipe-icon">🍽️</view><view class="recipe-info"><text class="recipe-name">{{recipe.name}}</text><text v-for="i in recipe.ingredients" :key="i.ingredientId" class="material">{{i.ingredient.name}} {{formatQuantity(i.quantity)}} {{i.unit}}</text><text class="material">调料：{{recipe.seasonings.map(s=>s.name).join('、')||'无'}}</text></view><text v-if="canAccess(session,'meals','EDIT') && (!meal || meal.status==='DRAFT')" class="add" :class="{added:selectedRecipeIds.has(recipe.id)}" @tap="toggleRecipe(recipe.id)">{{ownRecipeIds.has(recipe.id)?'撤回我的选择':selectedRecipeIds.has(recipe.id)?'我也想吃':'点这道菜'}}</text></view>
      <view class="primary" @tap="active='menu'">查看待做菜单（{{mealItems.length}}道）</view>
    </view>
    <view v-else-if="active==='recipes'">
      <view v-if="canAccess(session,'recipes','EDIT')" class="primary" @tap="addRecipe">＋ 添加菜谱</view>
      <view v-for="recipe in recipes" :key="recipe.id" class="recipe-card"><view class="recipe-info" @tap="canAccess(session,'recipes','EDIT')&&editRecipe(recipe.id)"><text class="recipe-name">{{recipe.name}}</text><text class="recipe-meta">{{recipe.ingredients.length}}种食材 · {{recipe.seasonings.length}}种调料 · 第{{recipe.version}}版</text></view><text v-if="recipe.status==='DRAFT' && canAccess(session,'recipes','EDIT')" class="publish" @tap="publish(recipe)">发布</text><text v-else class="status">{{recipe.status==='PUBLISHED'?'已发布':'已归档'}}</text></view>
    </view>
    <view v-else>
      <view class="meal-summary"><text>{{date}} {{mealType}} {{slotKey}}</text><text>{{meal?statusLabels[meal.status]:'尚未点菜'}}</text></view>
      <view v-if="meal?.legacyWithoutSnapshot" class="hint">这是旧版餐单，没有历史快照；不将当前菜谱当作当时用料。</view>
      <view v-if="!mealItems.length && !meal?.legacyWithoutSnapshot" class="empty">还没有选择菜品</view>
      <view v-for="item in mealItems" :key="item.recipeId" class="menu-item"><view class="menu-line"><text>{{item.recipe.name}}</text><text class="person">做{{Number(item.cookMultiplier)}}份</text></view><text class="material">想吃的人：{{item.wantedBy.map(w=>w.nickname||'家人').join('、')}}（{{item.wantedBy.length}}人）</text><text class="material">{{item.recipe.ingredients.map(i=>i.ingredient.name+' '+formatQuantity(i.quantity)+' '+i.unit).join('、')}}</text>
        <view v-if="meal?.status==='DRAFT' && canAccess(session,'meals','MANAGE')" class="menu-line"><input v-model="servings[item.recipeId]" type="digit" class="entry servings" placeholder="实际份数" /><text class="small-action" @tap="saveServings(item.recipeId)">保存份数</text></view>
      </view>
      <view v-if="mealItems.length && !canAccess(session,'inventory')" class="hint">用料可见，家庭库存只向获授权成员展示。</view>
      <view v-if="comparison.length" class="ingredients"><text class="block-title">全部食材、调料与库存对照</text><view v-for="item in comparison" :key="item.key" class="ingredient-row" :class="item.status.toLowerCase()" @tap="toggleShortage(item)"><text v-if="item.status==='SHORTAGE'" class="check">{{checkedShortages.includes(item.key)?'✓':''}}</text><view class="ingredient-name"><text>{{item.name}}</text><text v-if="item.kind==='FOOD'" class="amount-text">需要{{formatQuantity(item.required)}} {{item.unit}} · 库存{{formatQuantity(item.onHand)}} {{item.unit}}</text><text class="material">{{item.reason}}</text></view><text class="stock-status">{{item.status==='SHORTAGE'?'缺 '+formatQuantity(item.shortage)+' '+item.unit:stockLabels[item.status]}}</text></view></view>
      <view v-if="meal?.status==='DRAFT' && comparison.length" class="hint">当前是动态预估；确认菜单后才可按快照导入缺料。</view>
      <view v-if="meal && ['CONFIRMED','COOKING'].includes(meal.status) && canAccess(session,'shopping','EDIT') && comparison.some(i=>i.status==='SHORTAGE')" class="primary" @tap="confirmShopping">把勾选缺料加入购物清单</view>
      <view v-if="meal && canAccess(session,'meals','MANAGE')">
        <view v-if="meal.status==='DRAFT' && mealItems.length" class="primary" @tap="confirmAction('confirm')">确认已保存的份数和菜单</view>
        <view v-if="meal.status==='CONFIRMED'" class="form-box"><view class="primary" @tap="confirmAction('start')">开始烹饪</view><input v-model="reopenReason" class="entry" placeholder="改单原因" /><view class="secondary" @tap="confirmAction('reopen')">重新打开并保留旧快照</view></view>
        <view v-if="['CONFIRMED','COOKING'].includes(meal.status)" class="secondary" @tap="finishCooking">完成用餐（库存不自动变化）</view>
        <view v-if="!['COMPLETED','CANCELLED'].includes(meal.status)" class="small-action" @tap="confirmAction('cancel')">取消这顿餐点</view>
      </view>
      <view v-if="meal?.snapshotVersion" class="secondary" @tap="showHistory">查看历史菜单快照（{{meal.snapshotVersion}}版）</view><view v-for="entry in history" :key="entry.version" class="form-box"><text>版本{{entry.version}} · {{entry.createdAt}}</text><view v-for="dish in entry.data.dishes" :key="dish.recipeId" class="history-row"><text>{{dish.recipe.name}} × {{Number(dish.cookMultiplier)}}份</text><text class="material">{{dish.recipe.ingredients.map(i=>i.ingredient.name+' '+formatQuantity(i.quantity)+' '+i.unit).join('、')}}</text><text class="material">调料：{{dish.recipe.seasonings.map(s=>s.name).join('、')}}</text></view></view>
    </view>
  </view>
</template>
<style scoped>
.page{min-height:100vh;padding:36rpx 28rpx 48rpx;background:#fff7e9}.label,.title,.field-label,.field-value,.recipe-name,.recipe-meta,.block-title,.amount-text{display:block}.label{font-size:23rpx;letter-spacing:3rpx;color:#9a7746}.title{margin-top:8rpx;font-size:42rpx;font-weight:700;color:#55452f}.tabs{display:flex;margin:28rpx 0 22rpx;padding:7rpx;border-radius:20rpx;background:#f5e8d0}.tab{flex:1;padding:16rpx 4rpx;border-radius:15rpx;text-align:center;color:#876f50;font-size:24rpx}.tab.selected{background:#fffdf8;color:#5c472e;font-weight:600}.picker-row{display:flex;justify-content:space-between;padding:24rpx;border-radius:24rpx;background:#fffdf8}.field-label{font-size:20rpx;color:#a49788}.field-value{margin-top:8rpx;font-size:28rpx;color:#4e463c}.meal-types{display:flex;gap:9rpx;margin-top:8rpx}.meal-type{padding:7rpx 11rpx;border-radius:99rpx;background:#f1ece4;color:#8b8378;font-size:20rpx}.meal-type.chosen{background:#f7d99a;color:#795321}.categories{white-space:nowrap;margin:22rpx 0}.category{display:inline-block;margin-right:12rpx;padding:12rpx 20rpx;border-radius:99rpx;background:#fffdf8;color:#837668;font-size:23rpx}.category.chosen{background:#dfb96c;color:#fff}.recipe-card{display:flex;align-items:center;gap:16rpx;margin-top:15rpx;padding:22rpx;border-radius:24rpx;background:#fffdf8}.recipe-icon{display:flex;align-items:center;justify-content:center;width:66rpx;height:66rpx;border-radius:20rpx;background:#fbe4b4;font-size:31rpx}.recipe-info{min-width:0;flex:1}.recipe-name{font-size:28rpx;color:#54483b}.recipe-meta{max-width:100%;margin-top:7rpx;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:20rpx;color:#a09382}.add,.status,.publish{flex:none;margin-left:auto;padding:10rpx 14rpx;border-radius:99rpx;color:#967d5b;font-size:21rpx}.add{border:2rpx solid #dec497}.add.added{border-color:#71a57a;background:#e1f0df;color:#4f8058}.status{background:#e2f0df;color:#54825c}.publish{background:#f6ddb0;color:#8c5c20}.primary,.secondary{margin-top:28rpx;padding:25rpx;border-radius:24rpx;text-align:center;font-size:28rpx}.primary{background:#d99c48;color:#fff}.secondary{border:2rpx solid #d99c48;color:#9b6525}.recipe-actions{display:flex;justify-content:space-between;align-items:center;padding:20rpx 4rpx;color:#8b7b68;font-size:23rpx}.new-recipe{padding:12rpx 16rpx;border-radius:16rpx;background:#d99c48;color:#fff}.hint{margin-top:25rpx;color:#968c80;font-size:21rpx;line-height:1.6}.meal-summary{display:flex;justify-content:space-between;margin-bottom:15rpx;padding:23rpx;border-radius:22rpx;background:#fff0cd;color:#765328;font-size:25rpx}.menu-item,.ingredient-row{display:flex;align-items:center;justify-content:space-between;padding:22rpx;border-bottom:1rpx solid #eee5d6;background:#fffdf8;color:#574d42;font-size:25rpx}.person{color:#9b8e7e;font-size:21rpx}.ingredients{margin-top:24rpx;border-radius:20rpx;overflow:hidden}.block-title{padding:20rpx;background:#f5ead4;color:#785b35;font-size:25rpx}.ingredient-row{gap:14rpx;font-size:23rpx}.ingredient-row.shortage{background:#fff1ec}.ingredient-row.sufficient{background:#f1f8ee}.check{display:flex;align-items:center;justify-content:center;width:34rpx;height:34rpx;border:2rpx solid #d6b58c;border-radius:10rpx;color:#c47639}.ingredient-name{min-width:0;flex:1}.amount-text{margin-top:5rpx;color:#9b9387;font-size:19rpx}.stock-status{flex:none;color:#b06a3e;font-size:21rpx}.sufficient .stock-status{color:#5f8b63}.empty{margin-top:80rpx;text-align:center;color:#8f867a;font-size:27rpx}.back{display:inline-block;margin-top:24rpx;padding:17rpx 30rpx;border-radius:18rpx;background:#d99c48;color:white}
.form-box{margin-top:24rpx;padding:24rpx;border-radius:22rpx;background:#fffdf7}.entry{min-height:88rpx;border:2rpx solid #e4d7bd;border-radius:16rpx;padding:0 16rpx;margin-top:12rpx;font-size:28rpx}.form-box button{margin-top:12rpx;font-size:28rpx}.menu-item{display:block}.menu-line{display:flex;justify-content:space-between;align-items:center;gap:16rpx}.servings{width:130rpx}.small-action{padding:20rpx;color:#8b5d23}.material{display:block;margin-top:10rpx;color:#7c756b;font-size:24rpx}.error{padding:24rpx;background:#fff0e9;color:#ab4f28;line-height:1.6}.history-row{padding:18rpx;border-bottom:1rpx solid #e4d7bd}.needs_check .stock-status{color:#ac5a24}.ingredient-row{align-items:flex-start}.hint{font-size:26rpx}.person{font-size:24rpx}.ingredient-row.absent{background:#fff1ec}.ingredient-row.present{background:#f1f8ee}</style>
