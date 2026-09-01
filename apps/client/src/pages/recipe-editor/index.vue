<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { confirmMediaAsset, createMediaUploadIntent, createRecipe, getMediaReadUrl, getRecipe, listRecipeCategories, publicMediaUrl, updateRecipe, uploadMediaContent, type Recipe, type RecipeCategory } from '../../services/family-api';

const recipeId = ref('');
const recipeVersion = ref(0);
const recipeStatus = ref<Recipe['status']>('DRAFT');
const coverAssetId = ref('');
const coverPreview = ref('');
const coverUploading = ref(false);
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

async function loadPage(query?: Record<string, string | undefined>) {
  recipeId.value = query?.id ?? '';
  try {
    categories.value = await listRecipeCategories();
    if (recipeId.value) {
      const recipe = await getRecipe(recipeId.value);
      recipeVersion.value = recipe.version; recipeStatus.value = recipe.status; name.value = recipe.name;
      coverAssetId.value = recipe.coverAssetId ?? '';
      ingredients.value = recipe.ingredients.map(item => ({ name: item.ingredient.name, quantity: item.quantity === null ? '' : String(Number(item.quantity)), unit: item.unit }));
      seasonings.value = recipe.seasonings.length ? recipe.seasonings.map(item => item.name) : [''];
      steps.value = recipe.steps.length ? [...recipe.steps] : [''];
      const index = categories.value.findIndex(item => item.id === recipe.category?.id); categoryIndex.value = index < 0 ? 0 : index;
      uni.setNavigationBarTitle({ title: '编辑菜谱' });
      if (coverAssetId.value) { const read=await getMediaReadUrl(coverAssetId.value);coverPreview.value=publicMediaUrl(read.path); }
    }
  }
  catch (error) { uni.showToast({ title: message(error), icon: 'none' }); }
}

async function persist(leave=true) {
  const cleanIngredients = ingredients.value.filter((item) => item.name.trim());
  const cleanSteps = steps.value.map((item) => item.trim()).filter(Boolean);
  if (!name.value.trim() || !categories.value.length || !cleanIngredients.length || cleanIngredients.some((item) => !item.unit.trim()) || !cleanSteps.length) {
    uni.showToast({ title: '请填写菜名、分类、食材和做法', icon: 'none' }); return false;
  }
  saving.value = true;
  try {
    const input = {
      name: name.value.trim(),
      categoryId: categories.value[categoryIndex.value].id,
      ingredients: cleanIngredients.map((item) => ({ name: item.name.trim(), quantity: item.quantity === '' ? undefined : Number(item.quantity), unit: item.unit.trim() })),
      seasonings: seasonings.value.map((item) => item.trim()).filter(Boolean),
      steps: cleanSteps,
    };
    if (recipeId.value) {
      const updated = await updateRecipe(recipeId.value, { ...input, expectedVersion: recipeVersion.value });
      recipeVersion.value = updated.version;
    } else {
      const created = await createRecipe(input); recipeId.value = created.id; recipeVersion.value = created.version;
    }
    uni.showToast({ title: recipeStatus.value === 'DRAFT' ? '菜谱草稿已保存' : '菜谱已更新', icon: 'success' });
    if(leave)setTimeout(() => uni.navigateBack(), 500);
    return true;
  } catch (error) { uni.showToast({ title: message(error), icon: 'none' }); return false; }
  finally { saving.value = false; }
}
async function save(){await persist(true);}
function mimeFor(path:string){const clean=path.toLowerCase().split('?')[0];if(clean.endsWith('.jpg')||clean.endsWith('.jpeg'))return'image/jpeg' as const;if(clean.endsWith('.png'))return'image/png' as const;if(clean.endsWith('.webp'))return'image/webp' as const;throw new Error('请选择 JPG、PNG 或 WebP 图片');}
function readBytes(path:string){return new Promise<ArrayBuffer>((resolve,reject)=>{uni.getFileSystemManager().readFile({filePath:path,success(result){if(typeof result.data==='string')reject(new Error('图片读取格式错误'));else resolve(result.data as ArrayBuffer);},fail(error){reject(new Error(error.errMsg||'图片读取失败'));}});});}
async function chooseCover(){
  if(saving.value||coverUploading.value)return;
  try{
    const selected=await new Promise<{tempFilePath:string;size:number}>((resolve,reject)=>uni.chooseMedia({count:1,mediaType:['image'],sourceType:['album','camera'],success(result){const file=result.tempFiles[0];resolve({tempFilePath:file.tempFilePath,size:file.size});},fail(error){reject(new Error(error.errMsg||'未选择图片'));}}));
    if(selected.size>8*1024*1024)throw new Error('图片不能超过 8MB');
    const mimeType=mimeFor(selected.tempFilePath);
    if(!recipeId.value&&!await persist(false))return;
    coverUploading.value=true;
    const bytes=await readBytes(selected.tempFilePath);if(bytes.byteLength!==selected.size)throw new Error('图片读取大小不一致，请重新选择');
    const intent=await createMediaUploadIntent({ownerType:'RECIPE',ownerId:recipeId.value,expectedOwnerVersion:recipeVersion.value,mimeType,byteSize:bytes.byteLength});
    const uploaded=await uploadMediaContent(intent.uploadPath,bytes,mimeType);
    const confirmed=await confirmMediaAsset(intent.id,uploaded.checksumSha256);recipeVersion.value=confirmed.ownerVersion;coverAssetId.value=confirmed.asset.id;
    const read=await getMediaReadUrl(confirmed.asset.id);coverPreview.value=publicMediaUrl(read.path);uni.showToast({title:'封面已保存',icon:'success'});
  }catch(error){const text=message(error);if(!text.includes('cancel'))uni.showToast({title:text,icon:'none'});}finally{coverUploading.value=false;}
}

onLoad(loadPage);
</script>

<template>
  <view class="page">
    <view class="section"><text class="title">成品图片</text><image v-if="coverPreview" class="cover" :src="coverPreview" mode="aspectFill" /><view v-else class="cover-empty">🍲<text>发布前需要一张成品图</text></view><view class="cover-action" @tap="chooseCover">{{coverUploading?'正在安全上传…':coverAssetId?'更换封面':'选择封面'}}</view><text class="cover-note">草稿可以暂时不放图片；图片通过家庭权限读取，不公开存储桶地址。</text></view>
    <view class="section"><text class="title">基本信息</text><input v-model="name" class="input" placeholder="菜名" /><picker :range="categories" range-key="name" @change="categoryIndex = Number($event.detail.value)"><view class="input picker">{{ categoryName }}　›</view></picker></view>
    <view class="section"><text class="title">食材</text><view v-for="(item,index) in ingredients" :key="index" class="row"><input v-model="item.name" class="input short" placeholder="食材" /><input v-model="item.quantity" type="digit" class="input amount" placeholder="数量" /><input v-model="item.unit" class="input unit" placeholder="单位" /><text class="remove" @tap="removeIngredient(index)">×</text></view><text class="add" @tap="addIngredient">＋ 添加食材</text></view>
    <view class="section"><text class="title">调料（不填用量）</text><input v-for="(_,index) in seasonings" :key="index" v-model="seasonings[index]" class="input" placeholder="调料名称" /><text class="add" @tap="addSeasoning">＋ 添加调料</text></view>
    <view class="section"><text class="title">做法</text><view v-for="(_,index) in steps" :key="index" class="step"><textarea v-model="steps[index]" class="textarea" :placeholder="'步骤 ' + (index + 1)" /><text class="remove step-remove" @tap="removeStep(index)">×</text></view><text class="add" @tap="addStep">＋ 添加步骤</text></view>
    <view class="save" :class="{ disabled: saving }" @tap="save">{{ saving ? '保存中…' : recipeId ? '保存修改' : '保存草稿' }}</view>
  </view>
</template>

<style scoped>
.page{min-height:100vh;padding:26rpx 28rpx 48rpx;background:#f8f4ec}.section{margin-bottom:20rpx;padding:24rpx;border-radius:24rpx;background:#fffdf8}.title{display:block;margin-bottom:16rpx;font-size:29rpx;font-weight:600;color:#5a4e40}.input,.textarea{box-sizing:border-box;width:100%;margin-top:12rpx;padding:18rpx;border:2rpx solid #eee4d7;border-radius:15rpx;background:#fff;font-size:25rpx}.picker{color:#555}.row{display:flex;align-items:center;gap:8rpx}.short{width:38%}.amount{width:25%}.unit{width:24%}.remove{padding:8rpx;color:#c48c75;font-size:34rpx}.step{position:relative}.step-remove{position:absolute;top:15rpx;right:7rpx}.textarea{height:120rpx;padding-right:55rpx}.add{display:inline-block;margin-top:18rpx;color:#b47831;font-size:24rpx}.save{margin-top:32rpx;padding:25rpx;border-radius:24rpx;background:#d99c48;color:#fff;text-align:center;font-size:29rpx}.disabled{opacity:.55}
.cover{width:100%;height:330rpx;border-radius:20rpx}.cover-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:260rpx;border-radius:20rpx;background:#f8ead4;color:#8c6c43;font-size:68rpx}.cover-empty text{margin-top:12rpx;font-size:24rpx}.cover-action{margin-top:16rpx;padding:19rpx;border-radius:16rpx;background:#e8b86f;color:#fff;text-align:center;font-size:26rpx}.cover-note{display:block;margin-top:14rpx;color:#988b7b;font-size:22rpx;line-height:1.6}
</style>
