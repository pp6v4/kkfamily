<script setup lang="ts">
import { computed, ref } from 'vue';
import { onHide, onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import { confirmMediaAsset, createMediaUploadIntent, createRecipe, getMediaReadUrl, getRecipe, listRecipeCategories, publicMediaUrl, updateRecipe, uploadMediaContent, type Recipe, type RecipeCategory } from '../../services/family-api';
import { canAccess, getStoredSession, refreshAccess, type HouseholdContext } from '../../services/session';
import { ApiError } from '../../services/transport';

const recipeId = ref('');
const recipeVersion = ref(0);
const recipeStatus = ref<Recipe['status']>('DRAFT');
const coverAssetId = ref('');
const coverPreview = ref('');
const coverUploading = ref(false);
const name = ref('');
const categories = ref<RecipeCategory[]>([]);
const categoryIndex = ref(0);
const originalCategoryId = ref<string | null>(null);
const ingredients = ref([{ name: '', quantity: '', unit: 'g' }]);
const seasonings = ref(['']);
const steps = ref(['']);
const saving = ref(false);
const session = ref<HouseholdContext>();
const loading = ref(false), loadError = ref(''), coverError = ref('');
const pageVisible = ref(false);
const locked = computed(() => loading.value || saving.value || coverUploading.value);
let epoch = 0, disposed = false, routeId = '';
let routeIdentity: HouseholdContext | undefined;
const categoryOptions = computed(() => [{ id: '', name: '未分类', archivedAt: null }, ...categories.value.map(item => ({ id: item.id, name: item.name + (item.archivedAt ? '（已归档）' : ''), archivedAt: item.archivedAt }))]);
const categoryName = computed(() => categoryOptions.value[categoryIndex.value]?.name ?? '未分类');

function message(error: unknown) { return error instanceof Error ? error.message : '操作失败'; }
function addIngredient() { if (ready()) ingredients.value.push({ name: '', quantity: '', unit: 'g' }); }
function removeIngredient(index: number) { if (ready() && ingredients.value.length > 1) ingredients.value.splice(index, 1); }
function addSeasoning() { if (ready()) seasonings.value.push(''); }
function addStep() { if (ready()) steps.value.push(''); }
function removeStep(index: number) { if (ready() && steps.value.length > 1) steps.value.splice(index, 1); }
function pickCategory(event: { detail: { value: string } }) { if (ready()) categoryIndex.value = Number(event.detail.value); }
function sameIdentity(a?: HouseholdContext, b?: HouseholdContext) { return Boolean(a && b && a.householdId === b.householdId && a.membershipId === b.membershipId); }
function clearPrivate() {
  session.value = undefined; recipeId.value = ''; recipeVersion.value = 0; recipeStatus.value = 'DRAFT'; name.value = '';
  coverAssetId.value = ''; coverPreview.value = ''; coverError.value = ''; categories.value = []; categoryIndex.value = 0; originalCategoryId.value = null;
  ingredients.value = [{ name: '', quantity: '', unit: 'g' }]; seasonings.value = ['']; steps.value = [''];
}
function alive(token: number) { return !disposed && pageVisible.value && token === epoch; }
function current(token: number, identity?: HouseholdContext) {
  if (!alive(token)) return false;
  if (!sameIdentity(identity, getStoredSession())) { clearPrivate(); loadError.value = '账号或家庭已变化，请返回菜谱列表'; return false; }
  return true;
}
function ready() {
  if (disposed || !pageVisible.value || locked.value || loadError.value) return false;
  if (!current(epoch, session.value) || !canAccess(session.value, 'recipes', 'EDIT')) return false;
  return true;
}
function fail(error: unknown) {
  if (error instanceof ApiError && [401, 403, 404].includes(error.statusCode)) { clearPrivate(); loadError.value = message(error); }
  uni.showToast({ title: message(error), icon: 'none' });
}
function snapshot() {
  return { id: recipeId.value, version: recipeVersion.value, status: recipeStatus.value, name: name.value, coverAssetId: coverAssetId.value,
    categories: categories.value.map(item => ({ ...item })), categoryIndex: categoryIndex.value, originalCategoryId: originalCategoryId.value,
    ingredients: ingredients.value.map(item => ({ ...item })), seasonings: [...seasonings.value], steps: [...steps.value] };
}
type Draft = ReturnType<typeof snapshot>;
function restore(draft: Draft) {
  recipeId.value = draft.id; recipeVersion.value = draft.version; recipeStatus.value = draft.status; name.value = draft.name; coverAssetId.value = draft.coverAssetId;
  categories.value = draft.categories.map(item => ({ ...item })); categoryIndex.value = draft.categoryIndex; originalCategoryId.value = draft.originalCategoryId;
  ingredients.value = draft.ingredients.map(item => ({ ...item })); seasonings.value = [...draft.seasonings]; steps.value = [...draft.steps];
}
function recipeInput(draft: Draft) {
  const rows = draft.ingredients.filter(item => item.name.trim()), cleanSteps = draft.steps.map(item => item.trim()).filter(Boolean);
  if (!draft.name.trim() || !rows.length || rows.some(item => !item.unit.trim()) || !cleanSteps.length) throw new Error('请填写菜名、食材和做法');
  const prepared = rows.map(item => {
    const text = item.quantity.trim();
    if (text && (!/^\d+(?:\.\d{1,3})?$/.test(text) || Number(text) < 0.001 || Number(text) > 999999999.999)) throw new Error('食材数量请填大于0、最多3位小数的数字，或留空待确认');
    return { name: item.name.trim(), quantity: text ? Number(text) : undefined, unit: item.unit.trim() };
  });
  const selected = draft.categoryIndex === 0 ? undefined : draft.categories[draft.categoryIndex - 1];
  if (draft.categoryIndex !== 0 && !selected) throw new Error('分类已变化，请重新选择');
  const keepArchived = Boolean(selected?.archivedAt && selected.id === draft.originalCategoryId);
  return { name: draft.name.trim(), ingredients: prepared, seasonings: draft.seasonings.map(item => item.trim()).filter(Boolean), steps: cleanSteps,
    ...(draft.id ? (keepArchived ? {} : { categoryId: selected?.id || null }) : (selected ? { categoryId: selected.id } : {})) };
}
async function writeDraft(draft: Draft) {
  const input = recipeInput(draft);
  return draft.id ? updateRecipe(draft.id, { ...input, expectedVersion: draft.version }) : createRecipe({ ...input, categoryId: input.categoryId || undefined });
}
function acceptSaved(draft: Draft, saved: Recipe) {
  draft.id = saved.id; draft.version = saved.version; draft.status = saved.status;
  draft.originalCategoryId = draft.categoryIndex ? draft.categories[draft.categoryIndex - 1]?.id || null : null;
  routeId = saved.id; restore(draft);
}
async function readCover(token: number, identity: HouseholdContext) {
  const id = coverAssetId.value; coverPreview.value = ''; coverError.value = '';
  if (!id) return;
  try {
    const read = await getMediaReadUrl(id);
    if (current(token, identity) && coverAssetId.value === id) coverPreview.value = publicMediaUrl(read.path);
  } catch (error) {
    if (!current(token, identity)) return;
    if (error instanceof ApiError && [401, 403].includes(error.statusCode)) fail(error);
    else coverError.value = '封面预览暂不可用，已保存的封面不会丢失';
  }
}
async function reloadCover() { if (ready() && session.value) await readCover(epoch, session.value); }

async function loadPage() {
  if (disposed || !pageVisible.value || nativeOperation) return;
  const token = ++epoch, id = routeId, before = getStoredSession();
  clearPrivate(); loadError.value = ''; loading.value = true;
  try {
    const context = await refreshAccess();
    if (!current(token, context)) return;
    if ((before && !sameIdentity(before, context)) || (routeIdentity && !sameIdentity(routeIdentity, context))) { loadError.value = '账号或家庭已变化，请返回菜谱列表'; return; }
    if (!canAccess(context, 'recipes', 'EDIT')) { loadError.value = '尚未获得菜谱编辑权限'; return; }
    routeIdentity = context;
    const groups = await listRecipeCategories();
    if (!current(token, context)) return;
    const recipe = id ? await getRecipe(id) : undefined;
    if (!current(token, context)) return;
    session.value = context; categories.value = groups; recipeId.value = id;
    if (recipe) {
      recipeVersion.value = recipe.version; recipeStatus.value = recipe.status; name.value = recipe.name;
      originalCategoryId.value = recipe.category?.id ?? null;
      if (recipe.category && !categories.value.some(item => item.id === recipe.category!.id)) categories.value.push(recipe.category);
      coverAssetId.value = recipe.coverAssetId ?? '';
      ingredients.value = recipe.ingredients.length ? recipe.ingredients.map(item => ({ name: item.ingredient.name, quantity: item.quantity === null ? '' : String(Number(item.quantity)), unit: item.unit })) : [{ name: '', quantity: '', unit: 'g' }];
      seasonings.value = recipe.seasonings.length ? recipe.seasonings.map(item => item.name) : [''];
      steps.value = recipe.steps.length ? [...recipe.steps] : [''];
      const index = categoryOptions.value.findIndex(item => item.id === recipe.category?.id); categoryIndex.value = index < 0 ? 0 : index;
      uni.setNavigationBarTitle({ title: '编辑菜谱' });
      await readCover(token, context);
    }
  }
  catch (error) { if (alive(token)) { clearPrivate(); loadError.value = message(error); } }
  finally { if (alive(token)) loading.value = false; }
}

async function persist(leave=true) {
  if (!ready() || !session.value) return false;
  const draft = snapshot(), token = epoch, identity = session.value;
  saving.value = true;
  try {
    const saved = await writeDraft(draft);
    if (!current(token, identity)) return false;
    acceptSaved(draft, saved);
    uni.showToast({ title: recipeStatus.value === 'DRAFT' ? '菜谱草稿已保存' : '菜谱已更新', icon: 'success' });
    if (leave) uni.navigateBack();
    return true;
  } catch (error) { if (current(token, identity)) fail(error); return false; }
  finally { saving.value = false; }
}
async function save(){await persist(true);}
function mimeFor(path:string){const clean=path.toLowerCase().split('?')[0];if(clean.endsWith('.jpg')||clean.endsWith('.jpeg'))return'image/jpeg' as const;if(clean.endsWith('.png'))return'image/png' as const;if(clean.endsWith('.webp'))return'image/webp' as const;throw new Error('请选择 JPG、PNG 或 WebP 图片');}
function readBytes(path:string){return new Promise<ArrayBuffer>((resolve,reject)=>{uni.getFileSystemManager().readFile({filePath:path,success(result){if(typeof result.data==='string')reject(new Error('图片读取格式错误'));else resolve(result.data as ArrayBuffer);},fail(error){reject(new Error(error.errMsg||'图片读取失败'));}});});}
type NativeOperation = { identity: HouseholdContext; draft: Draft; stage: 'picking' | 'uploading'; visibleWait?: () => void; restoreEpoch?: number; restoration?: Promise<void> };
let nativeOperation: NativeOperation | undefined;
function nativeAlive(op: NativeOperation) { return !disposed && nativeOperation === op && sameIdentity(op.identity, getStoredSession()); }
function requireNative(op: NativeOperation) {
  if (!nativeAlive(op) || !pageVisible.value) throw new Error('账号、家庭或页面已变化，请重新打开菜谱');
}
async function authorizeNative(op: NativeOperation, checkVersion: boolean) {
  requireNative(op);
  const context = await refreshAccess(); requireNative(op);
  if (!sameIdentity(context, op.identity) || !canAccess(context, 'recipes', 'EDIT')) throw new ApiError('菜谱编辑权限已变化', 403);
  if (op.draft.id) {
    const latest = await getRecipe(op.draft.id); requireNative(op);
    if (checkVersion && latest.version !== op.draft.version) throw new ApiError('菜谱已被更新，请先处理版本冲突再上传封面', 409);
  }
  return context;
}
async function restoreNative(op: NativeOperation) {
  requireNative(op);
  if (op.restoreEpoch === epoch && op.restoration) return op.restoration;
  const token = epoch;
  op.restoreEpoch = token;
  op.restoration = (async () => {
    const context = await authorizeNative(op, false);
    if (!alive(token)) throw new Error('页面已变化');
    session.value = context; restore(op.draft); loadError.value = '';
    await readCover(token, context);
    if (!session.value) throw new ApiError('菜谱访问权限已变化', 403);
  })();
  return op.restoration;
}
function cancelNative() { const op = nativeOperation; nativeOperation = undefined; op?.visibleWait?.(); }
async function chooseCover() {
  if (!ready() || !session.value) return;
  const op: NativeOperation = { identity: session.value, draft: snapshot(), stage: 'picking' };
  nativeOperation = op; coverUploading.value = true;
  try {
    const choice = await new Promise<{ file?: { tempFilePath: string; size: number }; error?: Error }>(resolve => uni.chooseMedia({
      count: 1, mediaType: ['image'], sourceType: ['album', 'camera'],
      success(result) { resolve(Array.isArray(result.tempFiles) && result.tempFiles.length === 1 ? { file: result.tempFiles[0] } : { error: new Error('请选择一张图片') }); },
      fail(error) { resolve(error.errMsg?.includes('cancel') ? {} : { error: new Error(error.errMsg || '选图失败') }); },
    }));
    if (!nativeAlive(op)) return;
    if (!pageVisible.value) await new Promise<void>(resolve => { op.visibleWait = resolve; });
    requireNative(op); await restoreNative(op); requireNative(op);
    if (choice.error) throw choice.error;
    if (!choice.file) return;
    const file = choice.file;
    if (typeof file.tempFilePath !== 'string' || !file.tempFilePath) throw new Error('图片路径无效，请重新选择');
    if (!Number.isInteger(file.size) || file.size <= 0 || file.size > 8 * 1024 * 1024) throw new Error('图片必须大于0且不超过8MB');
    const mimeType = mimeFor(file.tempFilePath);
    op.stage = 'uploading';
    const bytes = await readBytes(file.tempFilePath); requireNative(op);
    if (bytes.byteLength !== file.size) throw new Error('图片读取大小不一致，请重新选择');
    await authorizeNative(op, true);
    if (!op.draft.id) {
      const saved = await writeDraft(op.draft); requireNative(op);
      acceptSaved(op.draft, saved);
    }
    await authorizeNative(op, true);
    const intent = await createMediaUploadIntent({ ownerType: 'RECIPE', ownerId: op.draft.id, expectedOwnerVersion: op.draft.version, mimeType, byteSize: bytes.byteLength });
    await authorizeNative(op, true);
    const uploaded = await uploadMediaContent(intent.uploadPath, bytes, mimeType);
    await authorizeNative(op, true);
    const confirmed = await confirmMediaAsset(intent.id, uploaded.checksumSha256); requireNative(op);
    op.draft.version = confirmed.ownerVersion; op.draft.coverAssetId = confirmed.asset.id; restore(op.draft);
    // Own cover updates advance the version; unsaved text stays in the draft.
    await authorizeNative(op, true); await readCover(epoch, op.identity); requireNative(op);
    if (session.value) uni.showToast({ title: '封面已保存', icon: 'success' });
  } catch (error) {
    if (nativeOperation === op && pageVisible.value && !disposed) {
      if (!sameIdentity(op.identity, getStoredSession())) { clearPrivate(); loadError.value = '账号或家庭已变化，请返回菜谱列表'; }
      else fail(error);
    }
  } finally {
    if (nativeOperation === op) {
      if (!sameIdentity(op.identity, getStoredSession()) && pageVisible.value) { clearPrivate(); loadError.value = '账号或家庭已变化，请返回菜谱列表'; }
      nativeOperation = undefined;
    }
    coverUploading.value = false;
  }
}
function hide() {
  pageVisible.value = false; epoch++; clearPrivate(); loading.value = false;
  if (nativeOperation?.stage === 'uploading') cancelNative();
}
onLoad(query => { cancelNative(); epoch++; clearPrivate(); routeId = query.id || ''; routeIdentity = undefined; });
onShow(async () => {
  if (disposed) return;
  pageVisible.value = true;
  const op = nativeOperation;
  if (op) {
    const token = epoch;
    op.visibleWait?.();
    try { await restoreNative(op); }
    catch (error) { if (alive(token) && nativeOperation === op) { cancelNative(); clearPrivate(); loadError.value = message(error); } }
  } else await loadPage();
});
onHide(hide);
onUnload(() => { disposed = true; cancelNative(); hide(); });
</script>

<template>
  <view class="page">
    <view v-if="loading" class="section">正在读取菜谱…</view>
    <view v-else-if="loadError" class="section" @tap="loadPage">{{ loadError }} · 点击重试</view>
    <template v-else-if="session">
      <view class="section"><text class="title">成品图片</text><image v-if="coverPreview" class="cover" :src="coverPreview" mode="aspectFill" @error="coverPreview='';coverError='封面预览暂不可用，点击重新加载'" /><view v-else class="cover-empty">🍲<text>{{ coverAssetId ? '已有封面，预览暂不可用' : '发布前需要一张成品图' }}</text></view><text v-if="coverError" class="cover-note" @tap="reloadCover">{{ coverError }}</text><view class="cover-action" :class="{disabled:locked}" @tap="chooseCover">{{coverUploading?'正在处理封面…':coverAssetId?'更换封面':'选择封面'}}</view><text class="cover-note">草稿可以暂时不放图片；新菜选图上传前会先保存草稿。图片通过家庭权限读取，不公开存储桶地址。</text></view>
      <view class="section"><text class="title">基本信息</text><input v-model="name" :disabled="locked" maxlength="80" class="input" placeholder="菜名" /><picker :disabled="locked" :value="categoryIndex" :range="categoryOptions" range-key="name" @change="pickCategory"><view class="input picker">{{ categoryName }} ›</view></picker><text v-if="categoryOptions[categoryIndex]?.archivedAt" class="cover-note">该分类已经归档；不切换时仍会保留在这道旧菜谱上。</text></view>
      <view class="section"><text class="title">食材</text><view v-for="(item,index) in ingredients" :key="index" class="row"><input v-model="item.name" :disabled="locked" maxlength="60" class="input short" placeholder="食材" /><input v-model="item.quantity" :disabled="locked" type="digit" class="input amount" placeholder="数量" /><input v-model="item.unit" :disabled="locked" maxlength="12" class="input unit" placeholder="单位" /><text class="remove" @tap="removeIngredient(index)">×</text></view><text class="add" @tap="addIngredient">＋ 添加食材</text></view>
      <view class="section"><text class="title">调料（不填用量）</text><input v-for="(_,index) in seasonings" :key="index" v-model="seasonings[index]" :disabled="locked" class="input" placeholder="调料名称" /><text class="add" @tap="addSeasoning">＋ 添加调料</text></view>
      <view class="section"><text class="title">做法</text><view v-for="(_,index) in steps" :key="index" class="step"><textarea v-model="steps[index]" :disabled="locked" maxlength="4000" class="textarea" :placeholder="'步骤 ' + (index + 1)" /><text class="remove step-remove" @tap="removeStep(index)">×</text></view><text class="add" @tap="addStep">＋ 添加步骤</text></view>
      <view class="save" :class="{ disabled: locked }" @tap="save">{{ saving ? '保存中…' : recipeId ? '保存修改' : '保存草稿' }}</view>
    </template>
  </view>
</template>

<style scoped>
.page{min-height:100vh;padding:26rpx 28rpx 48rpx;background:#f8f4ec}.section{margin-bottom:20rpx;padding:24rpx;border-radius:24rpx;background:#fffdf8}.title{display:block;margin-bottom:16rpx;font-size:29rpx;font-weight:600;color:#5a4e40}.input,.textarea{box-sizing:border-box;width:100%;margin-top:12rpx;padding:18rpx;border:2rpx solid #eee4d7;border-radius:15rpx;background:#fff;font-size:25rpx}.picker{color:#555}.row{display:flex;align-items:center;gap:8rpx}.short{width:38%}.amount{width:25%}.unit{width:24%}.remove{padding:8rpx;color:#c48c75;font-size:34rpx}.step{position:relative}.step-remove{position:absolute;top:15rpx;right:7rpx}.textarea{height:120rpx;padding-right:55rpx}.add{display:inline-block;margin-top:18rpx;color:#b47831;font-size:24rpx}.save{margin-top:32rpx;padding:25rpx;border-radius:24rpx;background:#d99c48;color:#fff;text-align:center;font-size:29rpx}.disabled{opacity:.55}
.cover{width:100%;height:330rpx;border-radius:20rpx}.cover-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:260rpx;border-radius:20rpx;background:#f8ead4;color:#8c6c43;font-size:68rpx}.cover-empty text{margin-top:12rpx;font-size:24rpx}.cover-action{margin-top:16rpx;padding:19rpx;border-radius:16rpx;background:#e8b86f;color:#fff;text-align:center;font-size:26rpx}.cover-note{display:block;margin-top:14rpx;color:#988b7b;font-size:22rpx;line-height:1.6}
</style>
