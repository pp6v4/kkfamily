<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { onHide, onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import { confirmMediaAsset, createMediaUploadIntent, createRecipe, getMediaReadUrl, getRecipe, listRecipeCategories, publicMediaUrl, updateRecipe, uploadMediaContent, type Recipe, type RecipeCategory } from '../../services/family-api';
import { canAccess, getStoredSession, refreshAccess, type HouseholdContext } from '../../services/session';
import { ApiError } from '../../services/transport';
import { readRecipeDraft, removeRecipeDraft, writeRecipeDraft, type RecipeDraftFields, type StoredRecipeDraft } from '../../services/recipe-draft';

const recipeId = ref('');
const recipeVersion = ref(0);
const recipeStatus = ref<Recipe['status']>('DRAFT');
const coverAssetId = ref('');
const coverPreview = ref('');
const coverUploading = ref(false);
type PendingCover = { tempFilePath: string; size: number; mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; localSaved?: boolean; confirmation?: { intentId: string; checksumSha256: string; expectedVersion: number } };
const pendingCover = ref<PendingCover>();
const name = ref('');
const validationErrors = ref<Record<string,string>>({});
class RecipeValidationError extends Error {
  constructor(public field:string,message:string){super(message);}
}
function invalid(field:string,message:string):never{throw new RecipeValidationError(field,message);}
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
const localRecovery = ref<StoredRecipeDraft>();
const draftCacheError = ref(''), draftNotice = ref(''), restoringDraft = ref(false), categoryNeedsReview = ref(false);
const missingCategoryId = ref<string | null>(null);
const coverBackupError = ref('');
const locked = computed(() => loading.value || saving.value || coverUploading.value || restoringDraft.value || Boolean(localRecovery.value));
let epoch = 0, disposed = false, routeId = '';
let routeIdentity: HouseholdContext | undefined;
let draftSlot = '', localRevision = '', baseline = '', hydrating = false;
let hiddenDraft: { identity: HouseholdContext; fields: RecipeDraftFields } | undefined;
const categoryOptions = computed(() => [{ id: '', name: '未分类', archivedAt: null }, ...categories.value.map(item => ({ id: item.id, name: item.name + (item.archivedAt ? '（已停用）' : ''), archivedAt: item.archivedAt }))]);
const categoryName = computed(() => categoryOptions.value[categoryIndex.value]?.name ?? '未分类');

function message(error: unknown) { return error instanceof Error ? error.message : '操作失败'; }
function allowRow(total: number, limit: number, label: string) {
  if (total < limit) return true;
  uni.showToast({ title: `${label}最多添加${limit}项`, icon: 'none' }); return false;
}
function addIngredient() { if (ready() && allowRow(ingredients.value.length, 100, '食材')) ingredients.value.push({ name: '', quantity: '', unit: 'g' }); }
function removeIngredient(index: number) {
  if (!ready() || !Number.isInteger(index) || index < 0 || index >= ingredients.value.length) return;
  if (ingredients.value.length > 1) ingredients.value.splice(index, 1);
  else ingredients.value[0] = { name: '', quantity: '', unit: 'g' };
}
function addSeasoning() { if (ready() && allowRow(seasonings.value.length, 40, '调料')) seasonings.value.push(''); }
function removeSeasoning(index: number) {
  if (!ready() || !Number.isInteger(index) || index < 0 || index >= seasonings.value.length) return;
  if (seasonings.value.length > 1) seasonings.value.splice(index, 1);
  else seasonings.value[0] = '';
}
function addStep() { if (ready() && allowRow(steps.value.length, 50, '做法步骤')) steps.value.push(''); }
function removeStep(index: number) { if (ready() && steps.value.length > 1) steps.value.splice(index, 1); }
function pickCategory(event: { detail: { value: string } }) { if (ready()) { categoryNeedsReview.value = false; missingCategoryId.value = null; categoryIndex.value = Number(event.detail.value); checkpointDraft(); } }
function sameIdentity(a?: HouseholdContext, b?: HouseholdContext) { return Boolean(a && b && a.householdId === b.householdId && a.membershipId === b.membershipId); }
function clearPrivate() {
  validationErrors.value={};
  const wasHydrating = hydrating; hydrating = true;
  session.value = undefined; recipeId.value = ''; recipeVersion.value = 0; recipeStatus.value = 'DRAFT'; name.value = '';
  coverAssetId.value = ''; coverPreview.value = ''; coverError.value = ''; pendingCover.value = undefined; categories.value = []; categoryIndex.value = 0; originalCategoryId.value = null;
  ingredients.value = [{ name: '', quantity: '', unit: 'g' }]; seasonings.value = ['']; steps.value = [''];
  localRecovery.value = undefined; draftNotice.value = ''; categoryNeedsReview.value = false; missingCategoryId.value = null; coverBackupError.value = '';
  hydrating = wasHydrating;
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
  if (error instanceof ApiError && [401, 403, 404].includes(error.statusCode)) { forgetDraft(); hiddenDraft = undefined; clearPrivate(); loadError.value = message(error); }
  uni.showToast({ title: message(error), icon: 'none' });
}
function snapshot() {
  return { id: recipeId.value, version: recipeVersion.value, status: recipeStatus.value, name: name.value, coverAssetId: coverAssetId.value,
    categories: categories.value.map(item => ({ ...item })), categoryIndex: categoryIndex.value, originalCategoryId: originalCategoryId.value,
    ingredients: ingredients.value.map(item => ({ ...item })), seasonings: [...seasonings.value], steps: [...steps.value], pendingCover: pendingCover.value ? { ...pendingCover.value } : undefined };
}
type Draft = ReturnType<typeof snapshot>;
function restore(draft: Draft) {
  const wasHydrating = hydrating; hydrating = true;
  recipeId.value = draft.id; recipeVersion.value = draft.version; recipeStatus.value = draft.status; name.value = draft.name; coverAssetId.value = draft.coverAssetId;
  categories.value = draft.categories.map(item => ({ ...item })); categoryIndex.value = draft.categoryIndex; originalCategoryId.value = draft.originalCategoryId;
  ingredients.value = draft.ingredients.map(item => ({ ...item })); seasonings.value = [...draft.seasonings]; steps.value = [...draft.steps];
  pendingCover.value = draft.pendingCover ? { ...draft.pendingCover } : undefined;
  if (draft.pendingCover) coverPreview.value = draft.pendingCover.tempFilePath;
  hydrating = wasHydrating;
}

function draftFields(draft = snapshot()): RecipeDraftFields {
  return { id: draft.id, version: draft.version, status: draft.status, name: draft.name,
    categoryId: categoryNeedsReview.value ? missingCategoryId.value : draft.categoryIndex ? draft.categories[draft.categoryIndex - 1]?.id ?? null : null,
    originalCategoryId: draft.originalCategoryId, coverAssetId: draft.coverAssetId,
    ingredients: draft.ingredients, seasonings: draft.seasonings, steps: draft.steps,
    ...(draft.pendingCover ? { pendingCover: draft.pendingCover } : {}) };
}
function contentKey(fields: RecipeDraftFields) {
  // The server's concurrency version is not a user edit.
  return JSON.stringify({ name: fields.name, categoryId: fields.categoryId, ingredients: fields.ingredients,
    seasonings: fields.seasonings, steps: fields.steps, coverAssetId: fields.coverAssetId, pendingCover: fields.pendingCover ?? null });
}
function forgetDraft(identity = session.value) {
  if (!identity || !localRevision) return;
  try { removeRecipeDraft(identity, draftSlot, localRevision); localRevision = ''; }
  catch { draftCacheError.value = '本机草稿暂时无法更新，请稍后重试。'; }
}
function checkpointDraft(force = false) {
  if (hydrating || disposed || !pageVisible.value || loading.value || localRecovery.value || !session.value || !sameIdentity(session.value, getStoredSession())) return false;
  if (!canAccess(session.value, 'recipes', 'EDIT') || (!force && (saving.value || coverUploading.value || restoringDraft.value))) return false;
  const fields = draftFields();
  try {
    if (contentKey(fields) === baseline) { forgetDraft(); return true; }
    const saved = writeRecipeDraft(session.value, draftSlot, fields); localRevision = saved.revision;
    draftCacheError.value = ''; return true;
  } catch { draftCacheError.value = '草稿暂未备份到本机，请保存后再退出。'; return false; }
}
function cachedDraft(identity: HouseholdContext) {
  try { const cached = readRecipeDraft(identity, draftSlot); localRevision = cached?.revision ?? ''; return cached; }
  catch { draftCacheError.value = '本机草稿暂时无法读取，请稍后重试。'; return undefined; }
}
async function applyLocalFields(fields: RecipeDraftFields, token: number, identity: HouseholdContext) {
  if (!current(token, identity)) return;
  const index = categoryOptions.value.findIndex(item => item.id === fields.categoryId);
  categoryNeedsReview.value = Boolean(fields.categoryId && index < 0);
  missingCategoryId.value = categoryNeedsReview.value ? fields.categoryId : null;
  restore({ ...fields, pendingCover: fields.pendingCover, categories: categories.value, categoryIndex: index < 0 ? 0 : index });
  routeId = fields.id;
  if (categoryNeedsReview.value) draftNotice.value = '原分类已停用，请重新选择分类。';
  else draftNotice.value = '已恢复未保存的内容';
  if (pendingCover.value && !pendingCover.value.confirmation) {
    try { await readBytes(pendingCover.value.tempFilePath); }
    catch {
      if (!current(token, identity)) return;
      pendingCover.value = undefined; coverPreview.value = ''; coverError.value = '原图片已失效，请重新选择；填写的内容已恢复。';
      return;
    }
    if (!pendingCover.value?.localSaved) coverBackupError.value = '图片暂未备份到本机，请保存后再退出。';
  }
  if (current(token, identity)) await readCover(token, identity);
}
function offerLocalDraft(token: number, identity: HouseholdContext) {
  const recovery = localRecovery.value;
  if (!recovery || !current(token, identity)) return;
  uni.showModal({ title: '发现未保存的菜谱', content: '是否继续上次的编辑？', confirmText: '继续编辑', cancelText: '稍后处理',
    success(result) { if (result.confirm && current(token, identity) && localRecovery.value?.revision === recovery.revision) void continueLocalDraft(); } });
}
async function continueLocalDraft() {
  const recovery = localRecovery.value, identity = session.value, token = epoch;
  if (!recovery || !identity || loading.value || restoringDraft.value || !current(token, identity)) return;
  restoringDraft.value = true;
  try {
    const access = await refreshAccess();
    if (!current(token, identity)) return;
    if (!sameIdentity(access, identity) || !canAccess(access, 'recipes', 'EDIT')) throw new ApiError('尚未获得菜谱编辑权限', 403);
    if (localRecovery.value?.revision !== recovery.revision) return;
    session.value = access; localRecovery.value = undefined;
    await applyLocalFields(recovery.fields, token, access);
  } catch (error) { if (current(token, identity)) fail(error); }
  finally { restoringDraft.value = false; if (current(token, identity)) checkpointDraft(); }
}
function discardLocalDraft() {
  const recovery = localRecovery.value, identity = session.value, token = epoch;
  if (!recovery || !identity || restoringDraft.value || !current(token, identity)) return;
  uni.showModal({ title: '放弃这份草稿？', content: '上次未保存的菜名、食材、调料、做法和本机图片将被清除。', confirmText: '放弃草稿', cancelText: '保留草稿',
    success(result) {
      if (!result.confirm || !current(token, identity) || localRecovery.value?.revision !== recovery.revision) return;
      try {
        const removed = removeRecipeDraft(identity, draftSlot, recovery.revision);
        if (!removed && readRecipeDraft(identity, draftSlot)) { uni.showToast({ title: '草稿有新改动，请重新读取', icon: 'none' }); return; }
        if (removed) releaseLocalCover(recovery.fields.pendingCover);
        localRevision = ''; localRecovery.value = undefined; hiddenDraft = undefined;
      } catch { draftCacheError.value = '草稿暂时无法清除，请稍后重试。'; }
    } });
}
function recipeInput(draft: Draft) {
  const rows = draft.ingredients.filter(item => item.name.trim()), cleanSteps = draft.steps.map(item => item.trim()).filter(Boolean);
  const cleanSeasonings = draft.seasonings.map(item => item.trim()).filter(Boolean);
  if (!draft.name.trim()) invalid('name','请填写菜品名称，例如：番茄炒蛋');
  if (draft.name.trim().length > 80) invalid('name','菜品名称最多80字，请缩短后保存');
  if (!rows.length) invalid('ingredients','请至少填写一种食材，例如：鸡蛋');
  if (rows.length > 100) invalid('ingredients','一道菜最多保存100种食材，请合并后保存');
  if (draft.ingredients.some(item => !item.name.trim() && item.quantity.trim())) invalid('ingredients','填写了数量的食材还需要填写名称');
  if (rows.some(item => item.name.trim().length > 60)) invalid('ingredients','每种食材名称最多60字，请缩短后保存');
  if (rows.some(item => !item.unit.trim())) invalid('ingredients','请填写食材单位，例如：个、克、把');
  if (rows.some(item => item.unit.trim().length > 12)) invalid('ingredients','食材单位最多12字，请缩短后保存');
  if (!cleanSteps.length) invalid('steps','请至少填写一个做法步骤');
  if (cleanSteps.length > 50) invalid('steps','一道菜最多保存50个做法步骤，请合并后保存');
  if (cleanSteps.some(item => item.length > 4000)) invalid('steps','每个做法步骤最多4000字，请拆分后保存');
  if (cleanSeasonings.length > 40) invalid('seasonings','一道菜最多保存40种调料，请合并后保存');
  const prepared = rows.map(item => {
    const text = item.quantity.trim();
    if (text && (!/^\d+(?:\.\d{1,3})?$/.test(text) || Number(text) < 0.001 || Number(text) > 999999999.999)) invalid('ingredients','食材数量请填大于0、最多3位小数的数字，或留空待确认');
    return { name: item.name.trim(), quantity: text ? Number(text) : undefined, unit: item.unit.trim() };
  });
  const selected = draft.categoryIndex === 0 ? undefined : draft.categories[draft.categoryIndex - 1];
  if (draft.categoryIndex !== 0 && !selected) invalid('category','分类已变化，请重新选择');
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
  const token = ++epoch, before = getStoredSession(), suspended = hiddenDraft;
  clearPrivate(); loadError.value = ''; loading.value = true;
  try {
    const context = await refreshAccess();
    if (!current(token, context)) return;
    if ((before && !sameIdentity(before, context)) || (routeIdentity && !sameIdentity(routeIdentity, context))) { loadError.value = '账号或家庭已变化，请返回菜谱列表'; return; }
    if (!canAccess(context, 'recipes', 'EDIT')) { loadError.value = '尚未获得菜谱编辑权限'; return; }
    routeIdentity = context;
    const cached = cachedDraft(context);
    const resumed = suspended && sameIdentity(suspended.identity, context) ? suspended.fields : undefined;
    const id = routeId || resumed?.id || cached?.fields.id || '';
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
    if (!current(token, context)) return;
    baseline = contentKey(draftFields());
    if (resumed) { await applyLocalFields(resumed, token, context); if (current(token, context)) hiddenDraft = undefined; }
    else if (cached) localRecovery.value = cached;
  }
  catch (error) {
    if (alive(token)) {
      if (error instanceof ApiError && [401, 403, 404].includes(error.statusCode)) { forgetDraft(before); hiddenDraft = undefined; }
      clearPrivate(); loadError.value = message(error);
    }
  }
  finally {
    if (alive(token)) {
      loading.value = false;
      if (session.value && localRecovery.value) offerLocalDraft(token, session.value);
      else checkpointDraft();
    }
  }
}

async function persist(leave=true) {
  if (!ready() || !session.value) return false;
  validationErrors.value={};
  const draft = snapshot(), token = epoch, identity = session.value;
  let textSaved = false;
  saving.value = true;
  if (draft.pendingCover) coverError.value = '';
  try {
    if (categoryNeedsReview.value) invalid('category','请重新选择菜谱分类');
    // A confirmation may have committed before its response was lost. Resolve
    // that exact intent before sending a text update with an obsolete version.
    if (draft.pendingCover?.confirmation) await confirmPendingCover(draft, token, identity);
    const saved = await writeDraft(draft);
    if (!current(token, identity)) return false;
    acceptSaved(draft, saved);
    checkpointDraft(true);
    textSaved = true;
    if (draft.pendingCover) await savePendingCover(draft, token, identity);
    if (!current(token, identity) || !session.value) return false;
    baseline = contentKey(draftFields()); forgetDraft(); hiddenDraft = undefined;
    draftNotice.value = ''; coverBackupError.value = '';
    uni.showToast({ title: recipeStatus.value === 'DRAFT' ? '菜谱草稿已保存' : '菜谱已更新', icon: 'success' });
    if (leave) uni.navigateBack();
    return true;
  } catch (error) {
    if (current(token, identity)) {
      if(error instanceof RecipeValidationError){
        validationErrors.value={[error.field]:error.message};
        await nextTick();
        if(current(token,identity))uni.pageScrollTo?.({selector:'#field-'+error.field,duration:200});
      }
      if (textSaved && draft.pendingCover && recipeId.value) coverError.value = draft.pendingCover.confirmation
        ? '文字已保存，封面确认结果待核实。再次保存会核对本次上传，不会重复创建。'
        : '文字已保存，封面尚未上传成功。请重试保存，或重新选择图片。';
      fail(error);
    }
    return false;
  }
  finally { saving.value = false; if (current(token, identity)) checkpointDraft(); }
}
async function save(){await persist(true);}
function mimeFor(path:string){const clean=path.toLowerCase().split('?')[0];if(clean.endsWith('.jpg')||clean.endsWith('.jpeg'))return'image/jpeg' as const;if(clean.endsWith('.png'))return'image/png' as const;if(clean.endsWith('.webp'))return'image/webp' as const;throw new Error('请选择 JPG、PNG 或 WebP 图片');}
function readBytes(path:string){return new Promise<ArrayBuffer>((resolve,reject)=>{uni.getFileSystemManager().readFile({filePath:path,success(result){if(typeof result.data==='string')reject(new Error('图片读取格式错误'));else resolve(result.data as ArrayBuffer);},fail(error){reject(new Error(error.errMsg||'图片读取失败'));}});});}
function releaseLocalCover(file?: PendingCover) {
  if (!file?.localSaved) return;
  // This is the one saved app-local file owned by this draft, not an album file.
  try { const manager = uni.getFileSystemManager(); manager.removeSavedFile?.({ filePath: file.tempFilePath, fail() {} }); } catch { /* A cache cleanup failure does not undo the saved recipe. */ }
}

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
  checkpointDraft(true);
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
  const localFile = draft.pendingCover;
  draft.version = confirmed.ownerVersion; draft.coverAssetId = confirmed.asset.id; draft.pendingCover = undefined;
  restore(draft);
  if (checkpointDraft(true)) releaseLocalCover(localFile);
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
      let localPath = file.tempFilePath, localSaved = false;
      const manager = uni.getFileSystemManager();
      if (typeof manager.saveFile === 'function') {
        try {
          localPath = await new Promise<string>((resolve, reject) => manager.saveFile({ tempFilePath: file.tempFilePath,
            success(result) { resolve(result.savedFilePath); }, fail(error) { reject(new Error(error.errMsg || '图片备份失败')); } }));
          localSaved = true;
        } catch {
          requireNative(op); draftCacheError.value = '图片暂未备份到本机，请保存后再退出。';
        }
      }
      if (!nativeAlive(op) || !pageVisible.value) {
        releaseLocalCover({ tempFilePath: localPath, size: file.size, mimeType, localSaved });
        return;
      }
      const previousFile = op.draft.pendingCover;
      op.draft.pendingCover = { tempFilePath: localPath, size: file.size, mimeType, localSaved };
      restore(op.draft); coverError.value = '';
      coverBackupError.value = localSaved ? '' : '图片暂未备份到本机，请保存后再退出。';
      if (checkpointDraft(true) && previousFile?.tempFilePath !== localPath) releaseLocalCover(previousFile);
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
    // The cover is already saved; keep only actual unsaved text in recovery.
    if (baseline) baseline = JSON.stringify({ ...JSON.parse(baseline), coverAssetId: confirmed.asset.id });
    checkpointDraft(true);
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
    if (pageVisible.value && !disposed) checkpointDraft();
  }
}
function hide() {
  if (session.value && sameIdentity(session.value, getStoredSession()) && !loading.value && !localRecovery.value) {
    const fields = draftFields();
    if (contentKey(fields) !== baseline) hiddenDraft = { identity: session.value, fields };
    checkpointDraft(true);
  }
  pageVisible.value = false; epoch++; clearPrivate(); loading.value = false;
  if (nativeOperation?.stage === 'uploading') cancelNative();
}
watch([name, categoryIndex, ingredients, seasonings, steps, coverAssetId, pendingCover], () => checkpointDraft(), { deep: true, flush: 'sync' });
onLoad(query => {
  cancelNative(); epoch++; clearPrivate(); routeId = query?.id || ''; draftSlot = routeId;
  routeIdentity = undefined; hiddenDraft = undefined; localRevision = ''; baseline = ''; draftCacheError.value = '';
});
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
onUnload(() => { hide(); disposed = true; cancelNative(); hiddenDraft = undefined; });
</script>

<template>
  <view class="page">
    <view v-if="loading" class="section">正在读取菜谱…</view>
    <view v-else-if="loadError" class="section" @tap="loadPage">{{ loadError }} · 点击重试</view>
    <template v-else-if="session">
      <view class="intro"><text class="intro-title">{{ recipeId ? '编辑菜谱' : '新建菜谱' }}</text><text>菜品信息、用料与烹饪步骤</text></view>
      <view v-if="localRecovery" class="section recovery">
        <text class="title">有一份未保存的菜谱</text><text class="cover-note">继续上次的编辑，或放弃草稿重新填写。</text>
        <view class="row"><button class="cover-action" :disabled="restoringDraft" @tap="continueLocalDraft">继续编辑</button><button class="remove" :disabled="restoringDraft" @tap="discardLocalDraft">放弃草稿</button></view>
      </view>
      <text v-if="draftCacheError || coverBackupError" class="draft-warning">{{ draftCacheError || coverBackupError }}</text>
      <text v-else-if="draftNotice" class="draft-notice">{{ draftNotice }}</text>
      <view class="section">
        <text class="title">基本信息</text>
        <text id="field-name" class="field-label">菜品名称 · 必填</text><text v-if="validationErrors.name" class="field-error">{{validationErrors.name}}</text><input :cursor-spacing="100" v-model="name" :disabled="locked" maxlength="80" class="input" placeholder="例如：番茄炒蛋" placeholder-class="input-placeholder" />
        <text id="field-category" class="field-label">菜品分类</text><text v-if="validationErrors.category" class="field-error">{{validationErrors.category}}</text><picker :disabled="locked" :value="categoryIndex" :range="categoryOptions" range-key="name" @change="pickCategory"><view class="input picker">{{ categoryName }}<text>选择分类 ›</text></view></picker>
        <text v-if="categoryOptions[categoryIndex]?.archivedAt" class="cover-note">该分类已停用，可选择其他分类。</text>
      </view>
      <view class="section">
        <text id="field-ingredients" class="title">食材 · 至少一种</text><text v-if="validationErrors.ingredients" class="field-error">{{validationErrors.ingredients}}</text>
        <view v-for="(item,index) in ingredients" :key="index" class="ingredient-card">
          <view class="row"><text class="field-label">食材 {{ index + 1 }}</text><button class="remove" :disabled="locked" @tap="removeIngredient(index)">{{ingredients.length>1?'移除':'清空'}}</button></view>
          <input :cursor-spacing="100" v-model="item.name" :disabled="locked" maxlength="60" class="input" placeholder="食材名称，例如：鸡蛋" placeholder-class="input-placeholder" />
          <view class="row amounts"><view><text class="field-label">数量 · 可不填</text><input :cursor-spacing="100" v-model="item.quantity" :disabled="locked" type="digit" class="input" placeholder="例如：2" placeholder-class="input-placeholder" /></view><view><text class="field-label">单位 · 必填</text><input :cursor-spacing="100" v-model="item.unit" :disabled="locked" maxlength="12" class="input" placeholder="例如：个、克、把" placeholder-class="input-placeholder" /></view></view>
        </view><text class="add" @tap="addIngredient">＋ 再加一种食材</text>
      </view>
      <view class="section"><text id="field-seasonings" class="title">调料 · 可不填</text><text v-if="validationErrors.seasonings" class="field-error">{{validationErrors.seasonings}}</text><view v-for="(_,index) in seasonings" :key="index"><view class="row"><text class="field-label">调料 {{ index + 1 }}</text><button class="remove" :disabled="locked" @tap="removeSeasoning(index)">{{seasonings.length>1?'移除':'清空'}}</button></view><input :cursor-spacing="100" v-model="seasonings[index]" :disabled="locked" maxlength="60" class="input" placeholder="例如：生抽" placeholder-class="input-placeholder" /></view><text class="add" @tap="addSeasoning">＋ 再加一种调料</text></view>
      <view class="section"><text id="field-steps" class="title">做法 · 至少一步</text><text v-if="validationErrors.steps" class="field-error">{{validationErrors.steps}}</text><view v-for="(_,index) in steps" :key="index" class="step"><view class="row"><text class="field-label">第 {{ index + 1 }} 步</text><text v-if="steps.length>1" class="remove" @tap="removeStep(index)">移除</text></view><textarea :cursor-spacing="100" v-model="steps[index]" :disabled="locked" maxlength="4000" class="textarea" :placeholder="index===0?'例如：番茄切块，鸡蛋打散备用。':'写下接着怎么做，例如：倒入鸡蛋翻炒至凝固。'" placeholder-class="input-placeholder" /></view><text class="add" @tap="addStep">＋ 再加一个步骤</text></view>
      <view class="section"><text class="title">成品图片</text><image v-if="coverPreview" class="cover" :src="coverPreview" mode="aspectFill" @error="coverPreview='';coverError='封面预览暂不可用，点击重新加载'" /><view v-else class="cover-empty">🍲<text>{{ coverAssetId ? '已有封面，预览暂不可用' : '添加菜品封面' }}</text></view><text v-if="coverError" class="cover-note" @tap="reloadCover">{{ coverError }}</text><view class="cover-action" :class="{disabled:locked}" @tap="chooseCover">{{coverUploading?'正在处理封面…':coverAssetId||pendingCover?'更换封面':'选择封面'}}</view><text class="cover-note">{{pendingCover?'图片待保存':'发布菜谱前请添加成品图'}}</text></view>
      <view class="save" :class="{ disabled: locked }" @tap="save">{{ saving ? '保存中…' : recipeId ? '保存修改' : '保存草稿' }}</view>
    </template>
  </view>
</template>

<style scoped>
.page{min-height:100vh;padding:26rpx 28rpx 48rpx;background:#f8f4ec}.section{margin-bottom:20rpx;padding:24rpx;border-radius:24rpx;background:#fffdf8}.title{display:block;margin-bottom:16rpx;font-size:29rpx;font-weight:600;color:#5a4e40}.input,.textarea{box-sizing:border-box;width:100%;margin-top:12rpx;border:2rpx solid #eee4d7;border-radius:15rpx;background:#fff;font-size:28rpx;color:#493f35}.input{height:88rpx;min-height:88rpx;padding:0 20rpx;line-height:44rpx;min-width:0}.picker{display:flex;align-items:center;justify-content:space-between;color:#555}.picker text{font-size:23rpx;color:#a78a60}.row{display:flex;align-items:center;justify-content:space-between;gap:16rpx}.amounts>view{flex:1;min-width:0}.remove{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;min-height:88rpx;min-width:88rpx;margin:0;padding:0 16rpx;border:0;border-radius:14rpx;background:#f8e9df;color:#ad715a;font-size:26rpx;line-height:38rpx}.step{margin-top:20rpx}.textarea{height:190rpx;padding:20rpx;line-height:42rpx}.add{display:inline-block;margin-top:24rpx;padding:10rpx 0;color:#a56b25;font-size:26rpx}.save{margin-top:32rpx;padding:25rpx;border-radius:24rpx;background:#d99c48;color:#fff;text-align:center;font-size:29rpx}.disabled{opacity:.55}
.intro{margin-bottom:24rpx;padding:10rpx 4rpx;color:#8b795f;font-size:24rpx;line-height:1.8}.intro-title{display:block;margin-bottom:8rpx;font-size:36rpx;font-weight:600;color:#584b38}.field-label{display:block;margin-top:20rpx;color:#6c5d4b;font-size:25rpx}.ingredient-card{margin-top:18rpx;padding:0 18rpx 20rpx;border-radius:18rpx;background:#f8f3e9}.input-placeholder{color:#a59b8c}
.cover{width:100%;height:330rpx;border-radius:20rpx}.cover-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:260rpx;border-radius:20rpx;background:#f8ead4;color:#8c6c43;font-size:68rpx}.cover-empty text{margin-top:12rpx;font-size:24rpx}.cover-action{margin-top:16rpx;padding:19rpx;border-radius:16rpx;background:#e8b86f;color:#fff;text-align:center;font-size:26rpx}.cover-note{display:block;margin-top:14rpx;color:#988b7b;font-size:22rpx;line-height:1.6}
.recovery{border:2rpx solid #e8c78b}.recovery .row{margin-top:18rpx}.recovery .cover-action{flex:1;margin:0}.draft-warning,.draft-notice{display:block;margin:0 4rpx 20rpx;font-size:24rpx;line-height:1.6}.draft-warning{color:#ad573c}.draft-notice{color:#768658}
</style>
<style scoped src="../../styles/page-foundation.css"></style>
