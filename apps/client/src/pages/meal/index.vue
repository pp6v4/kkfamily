<script setup lang="ts">
import { computed, ref } from 'vue';
import { onHide, onShow, onUnload } from '@dcloudio/uni-app';
import { addMealRecipe, archiveRecipeCategory, completeMeal, createMeal, createRecipeCategory, getMediaReadUrl, importMealShortages, listMeals, listRecipeCategories, listRecipes, publicMediaUrl, recalculateMeal, removeMealRecipe, updateRecipeCategory, updateRecipeStatus, transitionMeal, updateMealDish, listMealSnapshots, mealTypeCodes, mealTypeLabel, type IngredientComparison, type Meal, type Recipe, type RecipeCategory } from '../../services/family-api';
import { canAccess, getStoredSession, refreshAccess, type HouseholdContext } from '../../services/session';
import { takeCalendarTarget } from '../../services/calendar-navigation';
import { ApiError } from '../../services/transport';
import { isCalendarDate } from '../../services/trip-form';

type ViewName = 'order' | 'recipes' | 'menu';
const active = ref<ViewName>('order');
const mealTypes = ['早餐', '午餐', '晚餐', '加餐'];
const mealType = ref('晚餐'), slotKey = ref(''), targetMealId = ref<string>();
const slotInput = ref(''), writing = ref(false), pageVisible = ref(false);
let viewEpoch = 0, mealEpoch = 0, historyEpoch = 0, interactionEpoch = 0, editorEpoch = 0, disposed = false;
let loadedSelection = '';
let resume: { identity: HouseholdContext; date: string; type: string; id?: string } | undefined;
const date = ref(today()), recipes = ref<Recipe[]>([]), meal = ref<Meal>();
const comparison = ref<IngredientComparison[]>([]), checkedShortages = ref<string[]>([]);
const category = ref('全部'), loading = ref(false), errorText = ref('');
const recipeCategories = ref<RecipeCategory[]>([]), categoryName = ref('');
const categoryEditing = ref<RecipeCategory>(), categoryEditName = ref(''), categoryEditOrder = ref('');
const session = ref<HouseholdContext>();
const servings = ref<Record<string, string>>({});
const reopenReason = ref('');
const history = ref<Awaited<ReturnType<typeof listMealSnapshots>>>([]);
const coverUrls=ref<Record<string,string>>({});
const categories = computed(() => ['全部', ...recipeCategories.value.map(item => item.name)]);
const visibleRecipes = computed(() => recipes.value.filter(r => r.status === 'PUBLISHED' && (category.value === '全部' || r.category?.name === category.value)));
const mealItems = computed(() => meal.value?.menu ?? []);
const selectedRecipeIds = computed(() => new Set(mealItems.value.map(i => i.recipeId)));
const ownRecipeIds = computed(() => new Set((meal.value?.items ?? []).filter(i => i.addedById === session.value?.membershipId).map(i => i.recipeId)));
const statusLabels = { DRAFT: '大家点菜中', CONFIRMED: '菜单已确认', COOKING: '烹饪中', COMPLETED: '已完成', CANCELLED: '已取消' };
const stockLabels: Record<string,string> = { SUFFICIENT:'充足', UNKNOWN:'待确认', PRESENT:'有', ABSENT:'无', NEEDS_CHECK:'请核实过期批次' };
function today() { return new Date(Date.now()+8*3600000).toISOString().slice(0,10); }
function dayRange(day: string) { const from=day+'T00:00:00+08:00'; return {from,to:new Date(new Date(from).getTime()+86400000).toISOString()}; }
function message(error: unknown) { return error instanceof Error ? error.message : '操作失败'; }
function formatQuantity(value: string | number | null) { return value === null ? '待确认' : String(Number(value)); }
const busy = computed(() => loading.value || writing.value);
function sameIdentity(a?: HouseholdContext, b?: HouseholdContext) { return Boolean(a && b && a.householdId === b.householdId && a.membershipId === b.membershipId); }
function clearMeal() { meal.value = undefined; comparison.value = []; checkedShortages.value = []; servings.value = {}; history.value = []; reopenReason.value = ''; loadedSelection = ''; historyEpoch++; }
function clearPrivate() { clearMeal(); recipes.value = []; recipeCategories.value = []; coverUrls.value = {}; session.value = undefined; category.value = '全部'; categoryName.value = ''; cancelCategoryEdit(); }
function alive(token: number) { return !disposed && pageVisible.value && token === viewEpoch; }
function current(token: number, identity?: HouseholdContext) {
  if (!alive(token)) return false;
  if (!sameIdentity(identity, getStoredSession())) { viewEpoch++; mealEpoch++; clearPrivate(); loading.value = false; errorText.value = '账号或家庭已变化，请重新加载'; return false; }
  return true;
}
function fail(error: unknown) {
  if (error instanceof ApiError && [401, 403].includes(error.statusCode)) { viewEpoch++; mealEpoch++; clearPrivate(); loading.value = false; }
  errorText.value = message(error); uni.showToast({ title: errorText.value, icon: 'none' });
}
function selectionKey() { return [date.value, mealType.value, slotKey.value, targetMealId.value || ''].join('|'); }
function capture() { return { token: viewEpoch, read: mealEpoch, interaction: interactionEpoch, editor: editorEpoch, identity: session.value, selection: selectionKey(), slotDraft: slotInput.value, active: active.value, mealId: meal.value?.id, version: meal.value?.version }; }
function valid(scope: ReturnType<typeof capture>) {
  return current(scope.token, scope.identity) && scope.read === mealEpoch && scope.interaction === interactionEpoch && scope.editor === editorEpoch && scope.active === active.value
    && scope.selection === selectionKey() && scope.slotDraft === slotInput.value && scope.mealId === meal.value?.id && scope.version === meal.value?.version;
}
function ready(module: string, level: 'VIEW' | 'EDIT' | 'MANAGE' = 'VIEW') {
  if (busy.value || !current(viewEpoch, session.value)) return false;
  if (!canAccess(session.value, module, level)) { fail(new Error('尚未获得该操作权限')); return false; }
  if (module !== 'recipes' && mealType.value === '加餐' && slotInput.value.trim() !== slotKey.value) { fail(new Error('请先点击“查看这顿加餐”再操作')); return false; }
  if (module !== 'recipes' && loadedSelection && loadedSelection !== selectionKey()) { fail(new Error('请先查看所选餐点')); return false; }
  return true;
}
async function runWrite<T>(scope: ReturnType<typeof capture>, operation: () => Promise<T>, done: (value: T) => void | Promise<void>) {
  if (busy.value || !valid(scope)) return;
  writing.value = true; errorText.value = '';
  try { const result = await operation(); if (valid(scope)) await done(result); }
  catch (error) { if (valid(scope)) fail(error); }
  finally { writing.value = false; }
}
async function loadMealFromDatabase() {
  const token = viewEpoch, identity = session.value, read = ++mealEpoch, key = selectionKey();
  const selected = { day: date.value, type: mealType.value, slot: slotKey.value, id: targetMealId.value };
  clearMeal();
  const stillCurrent = () => current(token, identity) && read === mealEpoch && key === selectionKey();
  if (!identity || !canAccess(identity, 'meals')) return;
  try {
    if (!isCalendarDate(selected.day)) throw new Error('请选择有效日期');
    const range = dayRange(selected.day), rows = await listMeals(range.from, range.to);
    if (!stillCurrent()) return;
    const found = rows.find(item => item.localDate === selected.day && (selected.id ? item.id === selected.id : item.mealType === mealTypeCodes[selected.type] && item.slotKey === selected.slot));
    if (selected.id && !found) throw new Error('该餐点不存在或已经没有访问权限');
    const stock = found && !found.legacyWithoutSnapshot && canAccess(identity, 'inventory') ? await recalculateMeal(found.id) : [];
    if (!stillCurrent()) return;
    meal.value = found; comparison.value = stock;
    if (found) { mealType.value = mealTypeLabel(found.mealType); slotKey.value = found.slotKey; }
    slotInput.value = slotKey.value;
    servings.value = Object.fromEntries((found?.menu || []).map(dish => [dish.recipeId, String(Number(dish.cookMultiplier))]));
    checkedShortages.value = stock.filter(item => item.status === 'SHORTAGE').map(item => item.key);
    loadedSelection = selectionKey();
  } catch (error) { if (stillCurrent()) { clearMeal(); fail(error); } }
}
async function loadRecipes(token: number, identity: HouseholdContext) {
  if (!canAccess(identity, 'recipes')) return;
  const [groups, rows] = await Promise.all([listRecipeCategories(), listRecipes()]);
  if (!current(token, identity)) return;
  recipeCategories.value = groups; recipes.value = rows;
  await Promise.all(rows.filter(row => row.coverAssetId).map(async row => {
    if (!current(token, identity)) return;
    try { const media = await getMediaReadUrl(row.coverAssetId!); if (current(token, identity)) coverUrls.value[row.id] = publicMediaUrl(media.path); }
    catch (error) { if (error instanceof ApiError && [401, 403].includes(error.statusCode)) throw error; }
  }));
}
async function loadPage() {
  if (disposed || !pageVisible.value) return;
  const target = takeCalendarTarget('MEAL'), bookmark = resume, before = getStoredSession(), token = ++viewEpoch;
  resume = undefined; mealEpoch++; interactionEpoch++; clearPrivate(); errorText.value = ''; loading.value = true;
  let initialMealRead: number | undefined;
  try {
    const identity = await refreshAccess();
    if (!current(token, identity)) return;
    if (before && !sameIdentity(before, identity)) { errorText.value = '账号或家庭已变化，请重新加载'; return; }
    session.value = identity;
    if (bookmark) {
      if (sameIdentity(bookmark.identity, identity)) { date.value = bookmark.date; mealType.value = bookmark.type; targetMealId.value = bookmark.id; }
      else { date.value = today(); mealType.value = '晚餐'; targetMealId.value = undefined; }
      slotKey.value = ''; slotInput.value = '';
    }
    if (target) { date.value = target.date; targetMealId.value = target.sourceId; slotKey.value = ''; if (target.mealType && mealTypes.includes(target.mealType)) mealType.value = target.mealType; active.value = 'menu'; }
    const readingMeal = loadMealFromDatabase(); initialMealRead = mealEpoch;
    await Promise.all([loadRecipes(token, identity), readingMeal]);
  } catch (error) { if (alive(token)) { viewEpoch++; mealEpoch++; clearPrivate(); loading.value = false; fail(error); } }
  finally { if (alive(token) && (initialMealRead === undefined || initialMealRead === mealEpoch)) loading.value = false; }
}
async function changeSelection(day: string, type: string) {
  if (writing.value || !current(viewEpoch, session.value)) return;
  if (!isCalendarDate(day) || !mealTypes.includes(type)) { fail(new Error('请选择有效日期和餐别')); return; }
  date.value = day; mealType.value = type; slotKey.value = type === '加餐' ? slotInput.value.trim() : ''; targetMealId.value = undefined;
  interactionEpoch++; errorText.value = ''; loading.value = true;
  const pending = loadMealFromDatabase(), read = mealEpoch, token = viewEpoch;
  await pending; if (alive(token) && read === mealEpoch) loading.value = false;
}
function changeDate(event:{detail:{value:string}}) { return changeSelection(event.detail.value,mealType.value); }
function chooseMealType(type:string) { return changeSelection(date.value,type); }
function switchView(view: ViewName) { if (writing.value || active.value === view) return; interactionEpoch++; historyEpoch++; history.value = []; reopenReason.value = ''; cancelCategoryEdit(); active.value = view; }
async function toggleRecipe(recipeId:string) {
  if (!ready('meals', 'EDIT') || !canAccess(session.value, 'recipes') || !recipes.value.some(row => row.id === recipeId && row.status === 'PUBLISHED')) return;
  if (!isCalendarDate(date.value)) { fail(new Error('请选择有效日期')); return; }
  const scope = capture(), selected = meal.value, withdraw = ownRecipeIds.value.has(recipeId);
  const hour = ({ 早餐: '08', 午餐: '12', 晚餐: '18', 加餐: '21' } as Record<string, string>)[mealType.value];
  const input = { scheduledAt: `${date.value}T${hour}:00:00+08:00`, mealType: mealTypeCodes[mealType.value], slotKey: slotKey.value || undefined };
  await runWrite(scope, async () => {
    const target = selected || await createMeal(input);
    if (!valid(scope)) return;
    if (target.status !== 'DRAFT') throw new Error('餐单已锁定；需由厨师重新打开后点菜');
    if (withdraw) await removeMealRecipe(target.id, recipeId); else await addMealRecipe(target.id, recipeId);
  }, () => loadMealFromDatabase());
}
function addRecipe() { if (ready('recipes', 'EDIT')) uni.navigateTo({url:'/pages/recipe-editor/index'}); }
function editRecipe(id:string) { if (ready('recipes', 'EDIT') && recipes.value.some(row => row.id === id)) uni.navigateTo({url:'/pages/recipe-editor/index?id='+encodeURIComponent(id)}); }
async function saveCategory() {
  if(!ready('recipes','MANAGE'))return;
  const value=categoryName.value.trim();if(!value){fail(new Error('请输入分类名称'));return;}
  const sortOrder = recipeCategories.value.length;
  await runWrite(capture(), () => createRecipeCategory(value, sortOrder), created => { recipeCategories.value = [...recipeCategories.value, created]; categoryName.value = ''; uni.showToast({ title: '分类已添加', icon: 'success' }); });
}
function startCategoryEdit(item:RecipeCategory) { if(!ready('recipes','MANAGE'))return;editorEpoch++;categoryEditing.value=item;categoryEditName.value=item.name;categoryEditOrder.value=String(item.sortOrder); }
function cancelCategoryEdit() { editorEpoch++;categoryEditing.value=undefined;categoryEditName.value='';categoryEditOrder.value=''; }
async function saveCategoryEdit() {
  const current=categoryEditing.value;if(!current||!ready('recipes','MANAGE'))return;
  const name=categoryEditName.value.trim(),sortOrder=Number(categoryEditOrder.value);
  if(!name){fail(new Error('请输入分类名称'));return;}if(!/^\d+$/.test(categoryEditOrder.value.trim())||!Number.isInteger(sortOrder)||sortOrder<0||sortOrder>999){fail(new Error('排序请输入0到999的整数'));return;}
  await runWrite(capture(), () => updateRecipeCategory(current, {name,sortOrder}), updated => { recipeCategories.value=recipeCategories.value.map(item=>item.id===updated.id?updated:item).sort((a,b)=>a.sortOrder-b.sortOrder||a.name.localeCompare(b.name,'zh-CN'));cancelCategoryEdit();uni.showToast({title:'分类已更新',icon:'success'}); });
}
async function applyCategoryArchive(item:RecipeCategory) {
  if(!ready('recipes','MANAGE'))return;
  await runWrite(capture(), () => archiveRecipeCategory(item), () => { recipeCategories.value=recipeCategories.value.filter(group=>group.id!==item.id);if(category.value===item.name)category.value='全部';if(categoryEditing.value?.id===item.id)cancelCategoryEdit();uni.showToast({title:'分类已归档',icon:'none'}); });
}
function confirmCategoryArchive(item:RecipeCategory) { if(!ready('recipes','MANAGE'))return;const scope=capture();uni.showModal({title:'归档这个分类？',content:'分类会从新菜谱选项中隐藏；已有菜谱仍保留原分类名称。',success:async result=>{if(result.confirm&&valid(scope))await applyCategoryArchive(item);}}); }
async function applyRecipeStatus(recipe:Recipe,status:Recipe['status']) {
  if(!ready('recipes','EDIT'))return;
  await runWrite(capture(), () => updateRecipeStatus(recipe,status), updated => { recipes.value=recipes.value.map(item=>item.id===updated.id?updated:item);uni.showToast({title:status==='PUBLISHED'?'菜谱已发布':status==='ARCHIVED'?'菜谱已下架':'已恢复为草稿',icon:'none'}); });
}
function changeRecipeStatus(recipe:Recipe,status:Recipe['status']) {
  if(!ready('recipes','EDIT'))return;
  if(status!=='ARCHIVED'){void applyRecipeStatus(recipe,status);return;}
  const scope=capture();uni.showModal({title:'下架这道菜？',content:'下架后不能再加入新餐点；已经确认的历史菜单仍会保留。',success:async result=>{if(result.confirm&&valid(scope))await applyRecipeStatus(recipe,status);}});
}
async function saveServings(recipeId:string) {
  if(!ready('meals','MANAGE')||!meal.value||meal.value.status!=='DRAFT'||!mealItems.value.some(row=>row.recipeId===recipeId))return;
  const value=(servings.value[recipeId]||'').trim(), quantity=Number(value), target=meal.value;
  if(!/^\d+(?:\.\d{1,3})?$/.test(value)||quantity<0.001||quantity>100){fail(new Error('份数请填0.001到100，最多3位小数'));return;}
  await runWrite(capture(), () => updateMealDish(target,recipeId,quantity), () => loadMealFromDatabase());
}
function confirmAction(action:'confirm'|'reopen'|'start'|'cancel') {
  const current=meal.value;if(!current||!ready('meals','MANAGE'))return;
  const allowed={confirm:['DRAFT'],reopen:['CONFIRMED'],start:['CONFIRMED'],cancel:['DRAFT','CONFIRMED','COOKING']}[action];if(!allowed.includes(current.status))return;
  if(action==='reopen'&&!reopenReason.value.trim()){fail(new Error('请填写重新打开餐单的原因'));return;}
  const titles={confirm:'确认本餐菜单',reopen:'重新打开菜单',start:'开始烹饪',cancel:'取消这顿餐点'};
  const scope=capture(), reason=reopenReason.value.trim()||undefined;
  uni.showModal({title:titles[action],content:action==='confirm'?'按已保存份数锁定菜名和用料快照；普通点菜将停止。':action==='reopen'?'旧快照保留。重新确认时生成新版菜单，并记录原因。':'确认执行此操作？',success:async result=>{
    if(!result.confirm||!valid(scope)||!ready('meals','MANAGE'))return;
    await runWrite(scope, () => transitionMeal(current,action,reason), () => loadMealFromDatabase());
  }});
}
function toggleShortage(item:IngredientComparison) { if(!ready('inventory')||item.status!=='SHORTAGE'||!comparison.value.some(row=>row.key===item.key&&row.status==='SHORTAGE'))return; checkedShortages.value=checkedShortages.value.includes(item.key)?checkedShortages.value.filter(k=>k!==item.key):[...checkedShortages.value,item.key]; }
async function confirmShopping() {
  if(!ready('shopping','EDIT')||!canAccess(session.value,'inventory')||!canAccess(session.value,'meals')||!meal.value||!['CONFIRMED','COOKING'].includes(meal.value.status))return;
  const target=meal.value, keys=[...checkedShortages.value];
  if(!keys.length||keys.some(key=>!comparison.value.some(row=>row.key===key&&row.status==='SHORTAGE'))){fail(new Error('请重新勾选当前餐点要购买的缺料'));return;}
  await runWrite(capture(), () => importMealShortages(target,keys), () => { uni.showToast({title:'已加入清单，重复提交不会加倍',icon:'none'}); });
}
function finishCooking(){
  const current=meal.value;if(!current||!ready('meals','MANAGE')||!['CONFIRMED','COOKING'].includes(current.status))return;
  const scope=capture();
  uni.showModal({title:'完成这顿饭',content:'只记录餐点已完成，不会自动减少任何库存。库存仍由家人按需要手工核实。',success:async result=>{
    if(!result.confirm||!valid(scope)||!ready('meals','MANAGE'))return;
    await runWrite(scope, () => completeMeal(current), async () => {uni.showToast({title:'餐点已完成',icon:'success'});await loadMealFromDatabase();});
  }});
}
async function showHistory(){if(!ready('meals')||!meal.value)return;const scope=capture(),id=meal.value.id,read=++historyEpoch;history.value=[];try{const rows=await listMealSnapshots(id);if(valid(scope)&&read===historyEpoch)history.value=rows;}catch(error){if(valid(scope)&&read===historyEpoch)fail(error);}}
function hide(){if(session.value)resume={identity:session.value,date:date.value,type:mealType.value,id:meal.value?.id};pageVisible.value=false;viewEpoch++;mealEpoch++;interactionEpoch++;clearPrivate();slotKey.value='';slotInput.value='';targetMealId.value=undefined;loading.value=false;errorText.value='';}
onShow(()=>{if(disposed)return;pageVisible.value=true;return loadPage();});
onHide(hide);
onUnload(()=>{disposed=true;hide();resume=undefined;});
</script>
<template>
  <view class="page">
    <view class="heading"><text class="label">吃什么</text><text class="title">一起好好吃饭</text></view>
    <view class="tabs"><view class="tab" :class="{selected:active==='order'}" @tap="switchView('order')">去点餐</view><view class="tab" :class="{selected:active==='recipes'}" @tap="switchView('recipes')">菜谱</view><view class="tab" :class="{selected:active==='menu'}" @tap="switchView('menu')">待做菜单</view></view>
    <view v-if="errorText" class="error">{{errorText}}<text class="small-action" @tap="loadPage">刷新</text></view>
    <view v-if="busy" class="hint">{{ writing ? '正在保存本次操作…' : '正在同步家里的数据…' }}</view>
    <view v-if="active!=='recipes'" class="picker-row"><picker mode="date" :disabled="writing" :value="date" @change="changeDate"><text class="field-value">{{date}} ›</text></picker><view class="meal-types"><text v-for="item in mealTypes" :key="item" class="meal-type" :class="{chosen:mealType===item}" @tap="chooseMealType(item)">{{item}}</text></view></view>
    <view v-if="active!=='recipes' && mealType==='加餐'" class="form-box"><input v-model="slotInput" :disabled="busy" class="entry" placeholder="加餐名称，可留空；如下午茶" /><button :disabled="writing" @tap="changeSelection(date,mealType)">查看这顿加餐</button><text v-if="slotInput.trim()!==slotKey" class="material">名称尚未应用，请先查看这顿加餐。</text></view>
    <view v-if="active==='order'">
      <view v-if="!loading && !canAccess(session,'recipes')" class="empty">尚未获得菜谱访问权限</view>
      <scroll-view class="categories" scroll-x><text v-for="item in categories" :key="item" class="category" :class="{chosen:category===item}" @tap="category=item">{{item}}</text></scroll-view>
      <view v-if="meal && meal.status!=='DRAFT'" class="hint">{{statusLabels[meal.status]}}，普通点菜已停止。</view>
      <view v-if="!loading && canAccess(session,'recipes') && !visibleRecipes.length" class="empty">还没有已发布菜谱</view>
      <view v-for="recipe in visibleRecipes" :key="recipe.id" class="recipe-card"><image v-if="coverUrls[recipe.id]" class="recipe-cover" :src="coverUrls[recipe.id]" mode="aspectFill" /><view v-else class="recipe-icon">🍽️</view><view class="recipe-info"><text class="recipe-name">{{recipe.name}}</text><text v-for="i in recipe.ingredients" :key="i.ingredientId" class="material">{{i.ingredient.name}} {{formatQuantity(i.quantity)}} {{i.unit}}</text><text class="material">调料：{{recipe.seasonings.map(s=>s.name).join('、')||'无'}}</text></view><text v-if="canAccess(session,'meals','EDIT') && (!meal || meal.status==='DRAFT')" class="add" :class="{added:selectedRecipeIds.has(recipe.id)}" @tap="toggleRecipe(recipe.id)">{{ownRecipeIds.has(recipe.id)?'撤回我的选择':selectedRecipeIds.has(recipe.id)?'我也想吃':'点这道菜'}}</text></view>
      <view class="primary" @tap="switchView('menu')">查看待做菜单（{{mealItems.length}}道）</view>
    </view>
    <view v-else-if="active==='recipes'">
      <view v-if="canAccess(session,'recipes','EDIT')" class="primary" @tap="addRecipe">＋ 添加菜谱</view>
      <view v-if="canAccess(session,'recipes','MANAGE')" class="form-box">
        <text class="block-title plain-title">菜谱分类</text>
        <view class="inline-form"><input v-model="categoryName" :disabled="busy" maxlength="30" class="entry category-entry" placeholder="如主食、炒菜、海鲜" /><text class="small-action" @tap="saveCategory">添加分类</text></view>
        <view v-for="item in recipeCategories" :key="item.id" class="category-manage-row"><view><text>{{item.name}}</text><text class="material">排序 {{item.sortOrder}} · 第{{item.version}}版</text></view><view><text class="small-action" @tap="startCategoryEdit(item)">编辑</text><text class="archive-link" @tap="confirmCategoryArchive(item)">归档</text></view></view>
        <view v-if="categoryEditing" class="category-editor"><input v-model="categoryEditName" :disabled="busy" maxlength="30" class="entry" placeholder="分类名称" /><input v-model="categoryEditOrder" :disabled="busy" type="number" class="entry order-entry" placeholder="排序0-999" /><view class="inline-form"><text class="small-action" @tap="saveCategoryEdit">保存修改</text><text class="archive-link" @tap="!busy&&cancelCategoryEdit()">取消</text></view></view>
      </view>
      <view v-for="recipe in recipes" :key="recipe.id" class="recipe-card"><view class="recipe-info" @tap="canAccess(session,'recipes','EDIT')&&editRecipe(recipe.id)"><text class="recipe-name">{{recipe.name}}</text><text class="recipe-meta">{{recipe.category?.name||'未分类'}} · {{recipe.ingredients.length}}种食材 · {{recipe.seasonings.length}}种调料 · 第{{recipe.version}}版</text></view><text v-if="recipe.status==='DRAFT' && canAccess(session,'recipes','EDIT')" class="publish" @tap="changeRecipeStatus(recipe,'PUBLISHED')">发布</text><text v-else-if="recipe.status==='PUBLISHED' && canAccess(session,'recipes','EDIT')" class="archive-action" @tap="changeRecipeStatus(recipe,'ARCHIVED')">下架</text><text v-else-if="recipe.status==='ARCHIVED' && canAccess(session,'recipes','EDIT')" class="restore-action" @tap="changeRecipeStatus(recipe,'DRAFT')">恢复草稿</text><text v-else class="status">{{recipe.status==='PUBLISHED'?'已发布':'已归档'}}</text></view>
    </view>
    <view v-else>
      <view v-if="!loading && !canAccess(session,'meals')" class="empty">尚未获得餐点查看权限</view>
      <template v-if="canAccess(session,'meals')">
      <view class="meal-summary"><text>{{date}} {{mealType}} {{slotKey}}</text><text>{{meal?statusLabels[meal.status]:'尚未点菜'}}</text></view>
      <view v-if="meal?.legacyWithoutSnapshot" class="hint">这是旧版餐单，没有历史快照；不将当前菜谱当作当时用料。</view>
      <view v-if="!mealItems.length && !meal?.legacyWithoutSnapshot" class="empty">还没有选择菜品</view>
      <view v-for="item in mealItems" :key="item.recipeId" class="menu-item"><view class="menu-line"><text>{{item.recipe.name}}</text><text class="person">做{{Number(item.cookMultiplier)}}份</text></view><text class="material">想吃的人：{{item.wantedBy.map(w=>w.nickname||'家人').join('、')}}（{{item.wantedBy.length}}人）</text><text class="material">{{item.recipe.ingredients.map(i=>i.ingredient.name+' '+formatQuantity(i.quantity)+' '+i.unit).join('、')}}</text>
        <view v-if="meal?.status==='DRAFT' && canAccess(session,'meals','MANAGE')" class="menu-line"><input v-model="servings[item.recipeId]" :disabled="busy" type="digit" class="entry servings" placeholder="实际份数" /><text class="small-action" @tap="saveServings(item.recipeId)">保存份数</text></view>
      </view>
      <view v-if="mealItems.length && !canAccess(session,'inventory')" class="hint">用料可见，家庭库存只向获授权成员展示。</view>
      <view v-if="comparison.length" class="ingredients"><text class="block-title">全部食材、调料与库存对照</text><view v-for="item in comparison" :key="item.key" class="ingredient-row" :class="item.status.toLowerCase()" @tap="toggleShortage(item)"><text v-if="item.status==='SHORTAGE'" class="check">{{checkedShortages.includes(item.key)?'✓':''}}</text><view class="ingredient-name"><text>{{item.name}}</text><text v-if="item.kind==='FOOD'" class="amount-text">需要{{formatQuantity(item.required)}} {{item.unit}} · 库存{{formatQuantity(item.onHand)}} {{item.unit}}</text><text class="material">{{item.reason}}</text></view><text class="stock-status">{{item.status==='SHORTAGE'?'缺 '+formatQuantity(item.shortage)+' '+item.unit:stockLabels[item.status]}}</text></view></view>
      <view v-if="meal?.status==='DRAFT' && comparison.length" class="hint">当前是动态预估；确认菜单后才可按快照导入缺料。</view>
      <view v-if="meal && ['CONFIRMED','COOKING'].includes(meal.status) && canAccess(session,'shopping','EDIT') && comparison.some(i=>i.status==='SHORTAGE')" class="primary" @tap="confirmShopping">把勾选缺料加入购物清单</view>
      <view v-if="meal && canAccess(session,'meals','MANAGE')">
        <view v-if="meal.status==='DRAFT' && mealItems.length" class="primary" @tap="confirmAction('confirm')">确认已保存的份数和菜单</view>
        <view v-if="meal.status==='CONFIRMED'" class="form-box"><view class="primary" @tap="confirmAction('start')">开始烹饪</view><input v-model="reopenReason" :disabled="busy" maxlength="300" class="entry" placeholder="改单原因" /><view class="secondary" @tap="confirmAction('reopen')">重新打开并保留旧快照</view></view>
        <view v-if="['CONFIRMED','COOKING'].includes(meal.status)" class="secondary" @tap="finishCooking">完成用餐（库存不自动变化）</view>
        <view v-if="!['COMPLETED','CANCELLED'].includes(meal.status)" class="small-action" @tap="confirmAction('cancel')">取消这顿餐点</view>
      </view>
      <view v-if="meal?.snapshotVersion" class="secondary" @tap="showHistory">查看历史菜单快照（{{meal.snapshotVersion}}版）</view><view v-for="entry in history" :key="entry.version" class="form-box"><text>版本{{entry.version}} · {{entry.createdAt}}</text><view v-for="dish in entry.data.dishes" :key="dish.recipeId" class="history-row"><text>{{dish.recipe.name}} × {{Number(dish.cookMultiplier)}}份</text><text class="material">{{dish.recipe.ingredients.map(i=>i.ingredient.name+' '+formatQuantity(i.quantity)+' '+i.unit).join('、')}}</text><text class="material">调料：{{dish.recipe.seasonings.map(s=>s.name).join('、')}}</text></view></view>
      </template>
    </view>
  </view>
</template>
<style scoped>
.page{min-height:100vh;padding:36rpx 28rpx 48rpx;background:#fff7e9}.label,.title,.field-label,.field-value,.recipe-name,.recipe-meta,.block-title,.amount-text{display:block}.label{font-size:23rpx;letter-spacing:3rpx;color:#9a7746}.title{margin-top:8rpx;font-size:42rpx;font-weight:700;color:#55452f}.tabs{display:flex;margin:28rpx 0 22rpx;padding:7rpx;border-radius:20rpx;background:#f5e8d0}.tab{flex:1;padding:16rpx 4rpx;border-radius:15rpx;text-align:center;color:#876f50;font-size:24rpx}.tab.selected{background:#fffdf8;color:#5c472e;font-weight:600}.picker-row{display:flex;justify-content:space-between;padding:24rpx;border-radius:24rpx;background:#fffdf8}.field-label{font-size:20rpx;color:#a49788}.field-value{margin-top:8rpx;font-size:28rpx;color:#4e463c}.meal-types{display:flex;gap:9rpx;margin-top:8rpx}.meal-type{padding:7rpx 11rpx;border-radius:99rpx;background:#f1ece4;color:#8b8378;font-size:20rpx}.meal-type.chosen{background:#f7d99a;color:#795321}.categories{white-space:nowrap;margin:22rpx 0}.category{display:inline-block;margin-right:12rpx;padding:12rpx 20rpx;border-radius:99rpx;background:#fffdf8;color:#837668;font-size:23rpx}.category.chosen{background:#dfb96c;color:#fff}.recipe-card{display:flex;align-items:center;gap:16rpx;margin-top:15rpx;padding:22rpx;border-radius:24rpx;background:#fffdf8}.recipe-icon{display:flex;align-items:center;justify-content:center;width:66rpx;height:66rpx;border-radius:20rpx;background:#fbe4b4;font-size:31rpx}.recipe-info{min-width:0;flex:1}.recipe-name{font-size:28rpx;color:#54483b}.recipe-meta{max-width:100%;margin-top:7rpx;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:20rpx;color:#a09382}.add,.status,.publish,.archive-action,.restore-action{flex:none;margin-left:auto;padding:10rpx 14rpx;border-radius:99rpx;color:#967d5b;font-size:21rpx}.add{border:2rpx solid #dec497}.add.added{border-color:#71a57a;background:#e1f0df;color:#4f8058}.status{background:#e2f0df;color:#54825c}.publish{background:#f6ddb0;color:#8c5c20}.archive-action{background:#fbe5dc;color:#a05d43}.restore-action{background:#e3eee0;color:#54825c}.primary,.secondary{margin-top:28rpx;padding:25rpx;border-radius:24rpx;text-align:center;font-size:28rpx}.primary{background:#d99c48;color:#fff}.secondary{border:2rpx solid #d99c48;color:#9b6525}.recipe-actions{display:flex;justify-content:space-between;align-items:center;padding:20rpx 4rpx;color:#8b7b68;font-size:23rpx}.new-recipe{padding:12rpx 16rpx;border-radius:16rpx;background:#d99c48;color:#fff}.hint{margin-top:25rpx;color:#968c80;font-size:21rpx;line-height:1.6}.meal-summary{display:flex;justify-content:space-between;margin-bottom:15rpx;padding:23rpx;border-radius:22rpx;background:#fff0cd;color:#765328;font-size:25rpx}.menu-item,.ingredient-row{display:flex;align-items:center;justify-content:space-between;padding:22rpx;border-bottom:1rpx solid #eee5d6;background:#fffdf8;color:#574d42;font-size:25rpx}.person{color:#9b8e7e;font-size:21rpx}.ingredients{margin-top:24rpx;border-radius:20rpx;overflow:hidden}.block-title{padding:20rpx;background:#f5ead4;color:#785b35;font-size:25rpx}.plain-title{padding:0;background:transparent}.inline-form{display:flex;align-items:center;gap:12rpx}.category-entry{min-width:0;flex:1}.ingredient-row{gap:14rpx;font-size:23rpx}.ingredient-row.shortage{background:#fff1ec}.ingredient-row.sufficient{background:#f1f8ee}.check{display:flex;align-items:center;justify-content:center;width:34rpx;height:34rpx;border:2rpx solid #d6b58c;border-radius:10rpx;color:#c47639}.ingredient-name{min-width:0;flex:1}.amount-text{margin-top:5rpx;color:#9b9387;font-size:19rpx}.stock-status{flex:none;color:#b06a3e;font-size:21rpx}.sufficient .stock-status{color:#5f8b63}.empty{margin-top:80rpx;text-align:center;color:#8f867a;font-size:27rpx}.back{display:inline-block;margin-top:24rpx;padding:17rpx 30rpx;border-radius:18rpx;background:#d99c48;color:white}
.form-box{margin-top:24rpx;padding:24rpx;border-radius:22rpx;background:#fffdf7}.entry{min-height:88rpx;border:2rpx solid #e4d7bd;border-radius:16rpx;padding:0 16rpx;margin-top:12rpx;font-size:28rpx}.form-box button{margin-top:12rpx;font-size:28rpx}.menu-item{display:block}.menu-line{display:flex;justify-content:space-between;align-items:center;gap:16rpx}.servings{width:130rpx}.small-action{padding:20rpx;color:#8b5d23}.material{display:block;margin-top:10rpx;color:#7c756b;font-size:24rpx}.error{padding:24rpx;background:#fff0e9;color:#ab4f28;line-height:1.6}.history-row{padding:18rpx;border-bottom:1rpx solid #e4d7bd}.needs_check .stock-status{color:#ac5a24}.ingredient-row{align-items:flex-start}.hint{font-size:26rpx}.person{font-size:24rpx}.ingredient-row.absent{background:#fff1ec}.ingredient-row.present{background:#f1f8ee}.recipe-cover{width:100rpx;height:100rpx;flex:none;border-radius:20rpx;background:#fbe4b4}
.category-manage-row{display:flex;align-items:center;justify-content:space-between;padding:18rpx 0;border-bottom:1rpx solid #eee5d6;color:#574d42;font-size:25rpx}.archive-link{padding:20rpx;color:#aa6245}.category-editor{margin-top:16rpx;padding-top:8rpx;border-top:2rpx dashed #e4d7bd}.order-entry{width:220rpx}</style>
