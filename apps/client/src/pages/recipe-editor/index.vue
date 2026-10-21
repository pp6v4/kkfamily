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
type PendingCover = { tempFilePath: string; size: number; mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; confirmation?: { intentId: string; checksumSha256: string; expectedVersion: number } };
const pendingCover = ref<PendingCover>();
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
function allowRow(total: number, limit: number, label: string) {
  if (total < limit) return true;
  uni.showToast({ title: `${label}最多添加${limit}项`, icon: 'none' }); return false;
}
function addIngredient() { if (ready() && allowRow(ingredients.value.length, 100, '食材')) ingredients.value.push({ name: '', quantity: '', unit: 'g' }); }
function removeIngredient(index: number) { if (ready() && ingredients.value.length > 1) ingredients.value.splice(index, 1); }
function addSeasoning() { if (ready() && allowRow(seasonings.value.length, 40, '调料')) seasonings.value.push(''); }
function addStep() { if (ready() && allowRow(steps.value.length, 50, '做法步骤')) steps.value.push(''); }
function removeStep(index: number) { if (ready() && steps.value.length > 1) steps.value.splice(index, 1); }
function pickCategory(event: { detail: { value: string } }) { if (ready()) categoryIndex.value = Number(event.detail.value); }
function sameIdentity(a?: HouseholdContext, b?: HouseholdContext) { return Boolean(a && b && a.householdId === b.householdId && a.membershipId === b.membershipId); }
function clearPrivate() {
  session.value = undefined; recipeId.value = ''; recipeVersion.value = 0; recipeStatus.value = 'DRAFT'; name.value = '';
  coverAssetId.value = ''; coverPreview.value = ''; coverError.value = ''; pendingCover.value = undefined; categories.value = []; categoryIndex.value = 0; originalCategoryId.value = null;
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
    ingredients: ingredients.value.map(item => ({ ...item })), seasonings: [...seasonings.value], steps: [...steps.value], pendingCover: pendingCover.value ? { ...pendingCover.value } : undefined };
}
type Draft = ReturnType<typeof snapshot>;
function restore(draft: Draft) {
  recipeId.value = draft.id; recipeVersion.value = draft.version; recipeStatus.value = draft.status; name.value = draft.name; coverAssetId.value = draft.coverAssetId;
  categories.value = draft.categories.map(item => ({ ...item })); categoryIndex.value = draft.categoryIndex; originalCategoryId.value = draft.originalCategoryId;
  ingredients.value = draft.ingredients.map(item => ({ ...item })); seasonings.value = [...draft.seasonings]; steps.value = [...draft.steps];
  pendingCover.value = draft.pendingCover ? { ...draft.pendingCover } : undefined;
  if (draft.pendingCover) coverPreview.value = draft.pendingCover.tempFilePath;
}
function recipeInput(draft: Draft) {
  const rows = draft.ingredients.filter(item => item.name.trim()), cleanSteps = draft.steps.map(item => item.trim()).filter(Boolean);
  const cleanSeasonings = draft.seasonings.map(item => item.trim()).filter(Boolean);
  if (!draft.name.trim()) throw new Error('请填写菜品名称，例如：番茄炒蛋');
  if (draft.name.trim().length > 80) throw new Error('菜品名称最多80字，请缩短后保存');
  if (!rows.length) throw new Error('请至少填写一种食材，例如：鸡蛋');
  if (rows.length > 100) throw new Error('一道菜最多保存100种食材，请合并后保存');
  if (draft.ingredients.some(item => !item.name.trim() && item.quantity.trim())) throw new Error('填写了数量的食材还需要填写名称');
  if (rows.some(item => item.name.trim().length > 60)) throw new Error('每种食材名称最多60字，请缩短后保存');
  if (rows.some(item => !item.unit.trim())) throw new Error('请填写食材单位，例如：个、克、把');
  if (rows.some(item => item.unit.trim().length > 12)) throw new Error('食材单位最多12字，请缩短后保存');
  if (!cleanSteps.length) throw new Error('请至少填写一个做法步骤');
  if (cleanSteps.length > 50) throw new Error('一道菜最多保存50个做法步骤，请合并后保存');
  if (cleanSteps.some(item => item.length > 4000)) throw new Error('每个做法步骤最多4000字，请拆分后保存');
  if (cleanSeasonings.length > 40) throw new Error('一道菜最多保存40种调料，请合并后保存');
  const prepared = rows.map(item => {
    const text = item.quantity.trim();
    if (text && (!/^\d+(?:\.\d{1,3})?$/.test(text) || Number(text) < 0.001 || Number(text) > 999999999.999)) throw new Error('食材数量请填大于0、最多3位小数的数字，或留空待确认');
    return { name: item.name.trim(), quantity: text ? Number(text) : undefined, unit: item.unit.trim() };
  });
  const selected = draft.categoryIndex === 0 ? undefined : draft.categories[draft.categoryIndex - 1];
  if (draft.categoryIndex !== 0 && !selected) throw new Error('分类已变化，请重新选择');
  const keepArchived = Boolean(selected?.archivedAt && selected.id === draft.originalCategoryId);
  return { name: draft.name.trim(), ingredients: prepared, seasonings: cleanSeasonings, steps: cleanSteps,
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
  if (pendingCover.value) { coverPreview.value = pendingCover.value.tempFilePath; coverError.value = ''; return; }
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
  let textSaved = false;
  saving.value = true;
  if (draft.pendingCover) coverError.value = '';
  try {
    // A confirmation may have committed before its response was lost. Resolve
    // that exact intent before sending a text update with an obsolete version.
    if (draft.pendingCover?.confirmation) await confirmPendingCover(draft, token, identity);
    const saved = await writeDraft(draft);
    if (!current(token, identity)) return false;
    acceptSaved(draft, saved);
    textSaved = true;
    if (draft.pendingCover) await savePendingCover(draft, token, identity);
    if (!current(token, identity) || !session.value) return false;
    uni.showToast({ title: recipeStatus.value === 'DRAFT' ? '菜谱草稿已保存' : '菜谱已更新', icon: 'success' });
    if (leave) uni.navigateBack();
    return true;
  } catch (error) {
    if (current(token, identity)) {
      if (textSaved && draft.pendingCover && recipeId.value) coverError.value = draft.pendingCover.confirmation
        ? '文字已保存，封面确认结果待核实。再次保存会核对本次上传，不会重复创建。'
        : '文字已保存，封面尚未上传成功。请重试保存，或重新选择图片。';
      fail(error);
    }
    return false;
  }
  finally { saving.value = false; }
}
async function save(){await persist(true);}
function mimeFor(path:string){const clean=path.toLowerCase().split('?')[0];if(clean.endsWith('.jpg')||clean.endsWith('.jpeg'))return'image/jpeg' as const;if(clean.endsWith('.png'))return'image/png' as const;if(clean.endsWith('.webp'))return'image/webp' as const;throw new Error('请选择 JPG、PNG 或 WebP 图片');}
function readBytes(path:string){return new Promise<ArrayBuffer>((resolve,reject)=>{uni.getFileSystemManager().readFile({filePath:path,success(result){if(typeof result.data==='string')reject(new Error('图片读取格式错误'));else resolve(result.data as ArrayBuffer);},fail(error){reject(new Error(error.errMsg||'图片读取失败'));}});});}

async function savePendingCover(draft: Draft, token: number, identity: HouseholdContext) {
  const file = draft.pendingCover;
  if (!file) return;
  function requireCurrent() { if (!current(token, identity)) throw new Error('页面或家庭已变化，请重新进入菜谱'); }
  async function authorize() {
    requireCurrent();
    const context = await refreshAccess(); requireCurrent();
    if (!sameIdentity(context, identity) || !canAccess(context, 'recipes', 'EDIT')) throw new ApiError('菜谱编辑权限已变化', 403);
    const latest = await getRecipe(draft.id); requireCurrent();
    if (latest.version !== draft.version) throw new ApiError('菜谱已被更新，请重新打开后再保存封面', 409);
  }
  await authorize();
  const bytes = await readBytes(file.tempFilePath); requireCurrent();
  if (bytes.byteLength !== file.size) throw new Error('图片读取大小不一致，请重新选择');
  await authorize();
  const intent = await createMediaUploadIntent({ ownerType: 'RECIPE', ownerId: draft.id, expectedOwnerVersion: draft.version, mimeType: file.mimeType, byteSize: bytes.byteLength });
  await authorize();
  const uploaded = await uploadMediaContent(intent.uploadPath, bytes, file.mimeType);
  await authorize();
  file.confirmation = { intentId: intent.id, checksumSha256: uploaded.checksumSha256, expectedVersion: draft.version };
  restore(draft);
  await confirmPendingCover(draft, token, identity);
}

async function confirmPendingCover(draft: Draft, token: number, identity: HouseholdContext) {
  const confirmation = draft.pendingCover?.confirmation;
  if (!confirmation) return;
  function requireCurrent() { if (!current(token, identity)) throw new Error('页面或家庭已变化，请重新进入菜谱'); }
  requireCurrent();
  const context = await refreshAccess(); requireCurrent();
  if (!sameIdentity(context, identity) || !canAccess(context, 'recipes', 'EDIT')) throw new ApiError('菜谱编辑权限已变化', 403);
  const confirmed = await confirmMediaAsset(confirmation.intentId, confirmation.checksumSha256); requireCurrent();
  if (confirmed.ownerVersion !== confirmation.expectedVersion + 1) throw new ApiError('图片已确认，但菜谱又有新改动，请返回重新打开核对', 409);
  draft.version = confirmed.ownerVersion; draft.coverAssetId = confirmed.asset.id; draft.pendingCover = undefined;
  restore(draft);
  await readCover(token, identity);
  requireCurrent();
  if (!session.value) throw new ApiError('菜谱访问权限已变化', 403);
}
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
    if (!op.draft.id || op.draft.pendingCover) {
      // Choosing an image is an editing action, not a recipe submission. Keep
      // the local preview until the user explicitly saves a complete recipe.
      op.draft.pendingCover = { tempFilePath: file.tempFilePath, size: file.size, mimeType };
      restore(op.draft); coverError.value = '';
      uni.showToast({ title: '封面已选择，保存菜谱时上传', icon: 'none' });
      return;
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
onLoad(query => { cancelNative(); epoch++; clearPrivate(); routeId = query?.id || ''; routeIdentity = undefined; });
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
      <view class="intro"><text class="intro-title">把拿手菜记下来</text><text>先填写菜名、食材和做法，点底部保存时才检查。数量可留空，调料不用写用量。</text></view>
      <view class="section">
        <text class="title">基本信息</text>
        <text class="field-label">菜品名称 · 必填</text><input v-model="name" :disabled="locked" maxlength="80" class="input" placeholder="例如：番茄炒蛋" placeholder-class="input-placeholder" />
        <text class="field-label">菜品分类</text><picker :disabled="locked" :value="categoryIndex" :range="categoryOptions" range-key="name" @change="pickCategory"><view class="input picker">{{ categoryName }}<text>选择分类 ›</text></view></picker>
        <text v-if="categoryOptions[categoryIndex]?.archivedAt" class="cover-note">该分类已经归档；不切换时仍会保留在这道旧菜谱上。</text>
      </view>
      <view class="section">
        <text class="title">食材 · 至少一种</text><text class="cover-note">填写这道菜要用什么。数量不确定可以留空，单位可以用“个、克、把”。</text>
        <view v-for="(item,index) in ingredients" :key="index" class="ingredient-card">
          <view class="row"><text class="field-label">食材 {{ index + 1 }}</text><text v-if="ingredients.length>1" class="remove" @tap="removeIngredient(index)">移除</text></view>
          <input v-model="item.name" :disabled="locked" maxlength="60" class="input" placeholder="食材名称，例如：鸡蛋" placeholder-class="input-placeholder" />
          <view class="row amounts"><view><text class="field-label">数量 · 可不填</text><input v-model="item.quantity" :disabled="locked" type="digit" class="input" placeholder="例如：2" placeholder-class="input-placeholder" /></view><view><text class="field-label">单位 · 必填</text><input v-model="item.unit" :disabled="locked" maxlength="12" class="input" placeholder="例如：个、克、把" placeholder-class="input-placeholder" /></view></view>
        </view><text class="add" @tap="addIngredient">＋ 再加一种食材</text>
      </view>
      <view class="section"><text class="title">调料 · 可不填</text><text class="cover-note">只记名称，不需要用量，例如：盐、生抽、食用油。</text><view v-for="(_,index) in seasonings" :key="index"><text class="field-label">调料 {{ index + 1 }}</text><input v-model="seasonings[index]" :disabled="locked" maxlength="60" class="input" placeholder="例如：生抽" placeholder-class="input-placeholder" /></view><text class="add" @tap="addSeasoning">＋ 再加一种调料</text></view>
      <view class="section"><text class="title">做法 · 至少一步</text><view v-for="(_,index) in steps" :key="index" class="step"><view class="row"><text class="field-label">第 {{ index + 1 }} 步</text><text v-if="steps.length>1" class="remove" @tap="removeStep(index)">移除</text></view><textarea v-model="steps[index]" :disabled="locked" maxlength="4000" class="textarea" :placeholder="index===0?'例如：番茄切块，鸡蛋打散备用。':'写下接着怎么做，例如：倒入鸡蛋翻炒至凝固。'" placeholder-class="input-placeholder" /></view><text class="add" @tap="addStep">＋ 再加一个步骤</text></view>
      <view class="section"><text class="title">成品图片</text><image v-if="coverPreview" class="cover" :src="coverPreview" mode="aspectFill" @error="coverPreview='';coverError='封面预览暂不可用，点击重新加载'" /><view v-else class="cover-empty">🍲<text>{{ coverAssetId ? '已有封面，预览暂不可用' : '选一张让家人想吃的成品图' }}</text></view><text v-if="coverError" class="cover-note" @tap="reloadCover">{{ coverError }}</text><view class="cover-action" :class="{disabled:locked}" @tap="chooseCover">{{coverUploading?'正在处理封面…':coverAssetId||pendingCover?'更换封面':'选择封面'}}</view><text class="cover-note">{{pendingCover?'已选择图片，保存菜谱时上传。':'草稿可以暂不放图，发布到点餐菜单前需要成品图。新菜选图不会提前保存或校验内容。'}}</text></view>
      <view class="save" :class="{ disabled: locked }" @tap="save">{{ saving ? '保存中…' : recipeId ? '保存修改' : '保存草稿' }}</view>
    </template>
  </view>
</template>

<style scoped>
.page{min-height:100vh;padding:26rpx 28rpx 48rpx;background:#f8f4ec}.section{margin-bottom:20rpx;padding:24rpx;border-radius:24rpx;background:#fffdf8}.title{display:block;margin-bottom:16rpx;font-size:29rpx;font-weight:600;color:#5a4e40}.input,.textarea{box-sizing:border-box;width:100%;margin-top:12rpx;border:2rpx solid #eee4d7;border-radius:15rpx;background:#fff;font-size:28rpx;color:#493f35}.input{height:88rpx;min-height:88rpx;padding:0 20rpx;line-height:44rpx;min-width:0}.picker{display:flex;align-items:center;justify-content:space-between;color:#555}.picker text{font-size:23rpx;color:#a78a60}.row{display:flex;align-items:center;justify-content:space-between;gap:16rpx}.amounts>view{flex:1;min-width:0}.remove{padding:8rpx;color:#ad715a;font-size:23rpx}.step{margin-top:20rpx}.textarea{height:190rpx;padding:20rpx;line-height:42rpx}.add{display:inline-block;margin-top:24rpx;padding:10rpx 0;color:#a56b25;font-size:26rpx}.save{margin-top:32rpx;padding:25rpx;border-radius:24rpx;background:#d99c48;color:#fff;text-align:center;font-size:29rpx}.disabled{opacity:.55}
.intro{margin-bottom:24rpx;padding:10rpx 4rpx;color:#8b795f;font-size:24rpx;line-height:1.8}.intro-title{display:block;margin-bottom:8rpx;font-size:36rpx;font-weight:600;color:#584b38}.field-label{display:block;margin-top:20rpx;color:#6c5d4b;font-size:25rpx}.ingredient-card{margin-top:18rpx;padding:0 18rpx 20rpx;border-radius:18rpx;background:#f8f3e9}.input-placeholder{color:#a59b8c}
.cover{width:100%;height:330rpx;border-radius:20rpx}.cover-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:260rpx;border-radius:20rpx;background:#f8ead4;color:#8c6c43;font-size:68rpx}.cover-empty text{margin-top:12rpx;font-size:24rpx}.cover-action{margin-top:16rpx;padding:19rpx;border-radius:16rpx;background:#e8b86f;color:#fff;text-align:center;font-size:26rpx}.cover-note{display:block;margin-top:14rpx;color:#988b7b;font-size:22rpx;line-height:1.6}
</style>
