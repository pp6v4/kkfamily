<script setup lang="ts">
import { computed, ref } from 'vue';
import { onHide, onShow, onUnload } from '@dcloudio/uni-app';
import { archiveFavorite, confirmMediaAsset, convertFavorite, createFavorite, createMediaUploadIntent, getFavorite, getMediaReadUrl, listFavorites, publicMediaUrl, updateFavorite, uploadMediaContent, type Favorite } from '../../services/family-api';
import { canAccess, refreshAccess, type HouseholdContext } from '../../services/session';

const session=ref<HouseholdContext>(),favorites=ref<Favorite[]>([]),selected=ref<Favorite>(),showForm=ref(false),editing=ref(false),busy=ref(false),uploading=ref(false);
const previews=ref<string[]>([]),convertOpen=ref(false),convertIndex=ref(0),convertTitle=ref(''),convertDescription=ref(''),convertKey=ref('');
const form=ref({typeIndex:0,title:'',text:'',sourceUrl:'',tags:'',visibilityIndex:0});
const types=[{value:'TEXT' as const,label:'文字'},{value:'IMAGE' as const,label:'图片'},{value:'LINK' as const,label:'链接'}];
const visibilities=[{value:'PRIVATE' as const,label:'仅自己'},{value:'HOUSEHOLD' as const,label:'家庭可见'}];
const conversions=[{value:'RECIPE' as const,label:'菜谱草稿'},{value:'TASK' as const,label:'家庭待办'}];
const editable=computed(()=>Boolean(selected.value&&session.value&&canAccess(session.value,'favorites','EDIT')&&(selected.value.createdById===session.value.membershipId||canAccess(session.value,'favorites','MANAGE'))));
let viewEpoch=0,uploadEpoch=0,visible=true;
type ReturnTarget={id:string;householdId:string;membershipId:string};
let returnTarget:ReturnTarget|undefined;
function targetForSelection():ReturnTarget|undefined{return selected.value&&session.value?{id:selected.value.id,householdId:session.value.householdId,membershipId:session.value.membershipId}:undefined;}
function matches(context:HouseholdContext,target:ReturnTarget){return context.householdId===target.householdId&&context.membershipId===target.membershipId;}

function message(error:unknown){return error instanceof Error?error.message:'操作失败';}
function personName(item:Favorite){return item.createdBy.user.nickname||'家庭成员';}
function typeLabel(value:Favorite['type']){return types.find(item=>item.value===value)?.label||value;}
function resetConversion(){convertOpen.value=false;convertKey.value='';convertTitle.value='';convertDescription.value='';}
async function imageUrls(item:Favorite,epoch:number){return(await Promise.all((item.assetIds||[]).map(async assetId=>{if(epoch!==viewEpoch)return'';try{const read=await getMediaReadUrl(assetId);return publicMediaUrl(read.path);}catch{return'';}}))).filter(Boolean);}
function clearView(){viewEpoch++;session.value=undefined;favorites.value=[];selected.value=undefined;previews.value=[];showForm.value=false;editing.value=false;busy.value=false;resetConversion();form.value={typeIndex:0,title:'',text:'',sourceUrl:'',tags:'',visibilityIndex:0};}
async function load(target=targetForSelection()||returnTarget){
  clearView();returnTarget=undefined;const epoch=viewEpoch;busy.value=true;
  try{
    const context=await refreshAccess();if(epoch!==viewEpoch||!canAccess(context,'favorites'))return false;
    const rows=await listFavorites();if(epoch!==viewEpoch)return false;
    const candidate=target&&matches(context,target)?rows.find(item=>item.id===target.id):undefined;
    const detail=candidate?await getFavorite(candidate.id):undefined;if(epoch!==viewEpoch)return false;
    const urls=detail?await imageUrls(detail,epoch):[];if(epoch!==viewEpoch)return false;
    session.value=context;favorites.value=rows;selected.value=detail;previews.value=urls;return true;
  }catch(error){if(epoch===viewEpoch)uni.showToast({title:message(error),icon:'none'});return false;}
  finally{if(epoch===viewEpoch)busy.value=false;}
}
async function openFavorite(item:Favorite){
  if(uploading.value||!canAccess(session.value,'favorites'))return;
  close();const epoch=viewEpoch;busy.value=true;
  try{const detail=await getFavorite(item.id);if(epoch!==viewEpoch)return;const urls=await imageUrls(detail,epoch);if(epoch!==viewEpoch)return;selected.value=detail;previews.value=urls;}
  catch(error){if(epoch===viewEpoch)uni.showToast({title:message(error),icon:'none'});}finally{if(epoch===viewEpoch)busy.value=false;}
}
function newFavorite(){if(busy.value||uploading.value||!canAccess(session.value,'favorites','EDIT'))return;close();showForm.value=true;}
function editFavorite(){const item=selected.value;if(!item||busy.value||uploading.value||!editable.value)return;editing.value=true;showForm.value=true;form.value={typeIndex:Math.max(0,types.findIndex(row=>row.value===item.type)),title:item.title,text:item.text||'',sourceUrl:item.sourceUrl||'',tags:(item.tags||[]).join('，'),visibilityIndex:Math.max(0,visibilities.findIndex(row=>row.value===item.visibility))};}
function close(){viewEpoch++;uploadEpoch++;returnTarget=undefined;uploading.value=false;busy.value=false;selected.value=undefined;showForm.value=false;editing.value=false;previews.value=[];resetConversion();form.value={typeIndex:0,title:'',text:'',sourceUrl:'',tags:'',visibilityIndex:0};}
async function save(){if(busy.value||uploading.value||!canAccess(session.value,'favorites','EDIT')||(editing.value&&!editable.value)||!session.value)return;const value=form.value,type=types[value.typeIndex].value;if(!value.title.trim()){uni.showToast({title:'请填写标题',icon:'none'});return;}if(type==='TEXT'&&!value.text.trim()){uni.showToast({title:'请填写灵感内容',icon:'none'});return;}if(type==='LINK'&&!value.sourceUrl.trim()){uni.showToast({title:'请填写来源链接',icon:'none'});return;}const epoch=viewEpoch,context=session.value;busy.value=true;try{const common={type,title:value.title.trim(),tags:value.tags.split(/[，,]/).map(tag=>tag.trim()).filter(Boolean),visibility:visibilities[value.visibilityIndex].value};const saved=editing.value&&selected.value?await updateFavorite(selected.value,{...common,text:value.text.trim()||null,sourceUrl:value.sourceUrl.trim()||null}):await createFavorite({...common,text:value.text.trim()||undefined,sourceUrl:value.sourceUrl.trim()||undefined});if(epoch!==viewEpoch||!await load({id:saved.id,householdId:context.householdId,membershipId:context.membershipId}))return;uni.showToast({title:'收藏已保存',icon:'success'});}catch(error){if(epoch===viewEpoch)uni.showToast({title:message(error),icon:'none',duration:3000});}finally{if(epoch===viewEpoch)busy.value=false;}}
function askArchive(){const item=selected.value;if(!item||busy.value||uploading.value||!editable.value)return;const epoch=viewEpoch;uni.showModal({title:'归档这条收藏？',content:'归档后不会出现在收藏列表，已转换的草稿不会删除。',success:async result=>{if(!result.confirm||epoch!==viewEpoch)return;busy.value=true;try{await archiveFavorite(item);if(epoch!==viewEpoch||!await load())return;uni.showToast({title:'已归档',icon:'success'});}catch(error){if(epoch===viewEpoch)uni.showToast({title:message(error),icon:'none'});}finally{if(epoch===viewEpoch)busy.value=false;}}});}
function startConvert(){if(!selected.value||busy.value||uploading.value||!canAccess(session.value,'favorites','EDIT'))return;convertTitle.value=selected.value.title;convertDescription.value='';convertKey.value=`favorite-${Date.now()}-${Math.random().toString(36).slice(2)}`;convertOpen.value=true;}
async function runConvert(){const item=selected.value,target=conversions[convertIndex.value]?.value;if(!item||!target||!convertTitle.value.trim()||busy.value||uploading.value||!canAccess(session.value,'favorites','EDIT'))return;if(!canAccess(session.value,target==='RECIPE'?'recipes':'tasks','EDIT')){uni.showToast({title:'尚未获得目标功能的编辑权限',icon:'none'});return;}const epoch=viewEpoch;busy.value=true;try{const result=await convertFavorite(item,{targetType:target,idempotencyKey:convertKey.value,confirmedTitle:convertTitle.value.trim(),confirmedDescription:convertDescription.value.trim()||undefined});if(epoch!==viewEpoch)return;convertKey.value='';uni.showToast({title:result.repeated?'已打开原草稿':'草稿已创建',icon:'success'});if(result.targetType==='RECIPE')uni.navigateTo({url:`/pages/recipe-editor/index?id=${encodeURIComponent(result.targetId)}`});else uni.navigateTo({url:`/pages/tasks/index?id=${encodeURIComponent(result.targetId)}`});}catch(error){if(epoch===viewEpoch)uni.showToast({title:message(error),icon:'none',duration:3000});}finally{if(epoch===viewEpoch)busy.value=false;}}
function mimeFor(path:string){const clean=path.toLowerCase().split('?')[0];if(clean.endsWith('.jpg')||clean.endsWith('.jpeg'))return'image/jpeg' as const;if(clean.endsWith('.png'))return'image/png' as const;if(clean.endsWith('.webp'))return'image/webp' as const;throw new Error('请选择 JPG、PNG 或 WebP 图片');}
function readBytes(path:string){return new Promise<ArrayBuffer>((resolve,reject)=>uni.getFileSystemManager().readFile({filePath:path,success(result){if(typeof result.data==='string')reject(new Error('图片读取格式错误'));else resolve(result.data as ArrayBuffer);},fail(error){reject(new Error(error.errMsg||'图片读取失败'));}}));}
async function uploadContext(token:number,target:ReturnTarget){
  if(token!==uploadEpoch)return undefined;
  const context=await refreshAccess();if(token!==uploadEpoch)return undefined;
  if(!matches(context,target)||!canAccess(context,'favorites','EDIT'))throw new Error('账号、家庭或权限已变化，请重新打开收藏后选图');
  return context;
}
async function addImage(){
  const target=targetForSelection();if(!target||!editable.value||uploading.value||busy.value)return;
  const token=++uploadEpoch;uploading.value=true;returnTarget=target;let succeeded=false;
  try{
    const file=await new Promise<{tempFilePath:string;size:number}>((resolve,reject)=>uni.chooseMedia({count:1,mediaType:['image'],sourceType:['album','camera'],success(result){const chosen=result.tempFiles[0];chosen?resolve(chosen):reject(new Error('未选择图片'));},fail(error){reject(new Error(error.errMsg||'未选择图片'));}}));
    const context=await uploadContext(token,target);if(!context)return;
    if(file.size>8*1024*1024)throw new Error('图片不能超过 8MB');
    const current=await getFavorite(target.id);if(token!==uploadEpoch)return;
    if(current.createdById!==context.membershipId&&!canAccess(context,'favorites','MANAGE'))throw new Error('当前账号不能修改这条收藏');
    const mimeType=mimeFor(file.tempFilePath),bytes=await readBytes(file.tempFilePath);if(token!==uploadEpoch)return;
    if(bytes.byteLength!==file.size)throw new Error('图片读取大小不一致，请重新选择');
    if(!await uploadContext(token,target))return;
    const intent=await createMediaUploadIntent({ownerType:'FAVORITE',ownerId:target.id,expectedOwnerVersion:current.version,mimeType,byteSize:bytes.byteLength});
    if(!await uploadContext(token,target))return;
    const uploaded=await uploadMediaContent(intent.uploadPath,bytes,mimeType);
    if(!await uploadContext(token,target))return;
    await confirmMediaAsset(intent.id,uploaded.checksumSha256);if(token!==uploadEpoch)return;succeeded=true;
  }catch(error){const text=message(error);if(token===uploadEpoch&&visible&&!text.includes('cancel'))uni.showToast({title:text,icon:'none'});}
  finally{
    if(token===uploadEpoch){uploading.value=false;if(visible){const loaded=await load(target);if(loaded&&succeeded)uni.showToast({title:'图片已添加',icon:'success'});}}
  }
}
function copyLink(){if(selected.value?.sourceUrl)uni.setClipboardData({data:selected.value.sourceUrl});}
async function preview(index:number){
  const item=selected.value;if(!item||busy.value||uploading.value)return;const epoch=viewEpoch;busy.value=true;
  try{const urls=await imageUrls(item,epoch);if(epoch!==viewEpoch)return;if(!urls.length){uni.showToast({title:'图片暂时无法访问，请刷新后重试',icon:'none'});return;}previews.value=urls;uni.previewImage({current:urls[Math.min(index,urls.length-1)],urls});}
  finally{if(epoch===viewEpoch)busy.value=false;}
}
function hidePage(){visible=false;returnTarget=targetForSelection()||returnTarget;clearView();}
function unloadPage(){uploadEpoch++;uploading.value=false;hidePage();returnTarget=undefined;}
function showPage(){visible=true;if(!uploading.value)return load();}
onShow(showPage);
onHide(hidePage);
onUnload(unloadPage);
</script>

<template>
  <view class="page">
    <view class="head"><text class="eyebrow">收藏与灵感</text><text class="title">喜欢的，先收起来</text><text class="subtitle">记文字、图片或链接；不自动抓取网页内容。</text></view>
    <text v-if="uploading" class="subtitle">正在处理所选图片…</text>
    <template v-if="!selected&&!showForm">
      <view v-for="item in favorites" :key="item.id" class="favorite" @tap="openFavorite(item)"><view class="stamp">{{item.type==='LINK'?'🔗':item.type==='IMAGE'?'🖼️':'💡'}}</view><view class="grow"><text class="favorite-title">{{item.title}}</text><text class="meta">{{typeLabel(item.type)}} · {{item.visibility==='PRIVATE'?'仅自己':'家庭可见'}} · {{personName(item)}}</text><view v-if="item.tags?.length" class="tags"><text v-for="tag in item.tags" :key="tag">#{{tag}}</text></view></view><text class="go">›</text></view>
      <text v-if="!favorites.length" class="empty">还没有收藏，先记下一点想法吧。</text>
      <view v-if="canAccess(session,'favorites','EDIT')" class="primary" @tap="newFavorite">＋ 记录一个灵感</view>
    </template>
    <view v-if="showForm" class="card">
      <text class="back" @tap="showForm=false">‹ 返回</text><text class="card-title">{{editing?'编辑收藏':'记录一个灵感'}}</text>
      <picker :range="types" range-key="label" :value="form.typeIndex" @change="form.typeIndex=Number($event.detail.value)"><view class="input">类型：{{types[form.typeIndex].label}}　›</view></picker>
      <input v-model="form.title" class="input" placeholder="标题"/><textarea v-model="form.text" class="textarea" placeholder="写下自己的想法（文字类型必填）"/><input v-model="form.sourceUrl" class="input" placeholder="http(s) 来源链接（链接类型必填）"/><input v-model="form.tags" class="input" placeholder="标签，用逗号分隔"/>
      <picker :range="visibilities" range-key="label" :value="form.visibilityIndex" @change="form.visibilityIndex=Number($event.detail.value)"><view class="input">可见范围：{{visibilities[form.visibilityIndex].label}}　›</view></picker>
      <view class="primary" :class="{disabled:busy}" @tap="save">{{busy?'保存中…':'保存收藏'}}</view><view class="cancel" @tap="showForm=false">取消</view>
    </view>
    <view v-if="selected&&!showForm" class="card detail">
      <text class="back" @tap="close">‹ 返回收藏</text><view class="badges"><text>{{typeLabel(selected.type)}}</text><text>{{selected.visibility==='PRIVATE'?'仅自己':'家庭可见'}}</text></view><text class="detail-title">{{selected.title}}</text><text v-if="selected.text" class="body">{{selected.text}}</text><view v-if="selected.sourceUrl" class="link" @tap="copyLink">{{selected.sourceUrl}}<text>复制</text></view>
      <view v-if="previews.length" class="grid"><image v-for="(url,index) in previews" :key="url" class="photo" :src="url" mode="aspectFill" @tap="preview(index)"/></view>
      <view v-if="selected.tags?.length" class="tags large"><text v-for="tag in selected.tags" :key="tag">#{{tag}}</text></view><text class="owner">由 {{personName(selected)}} 收藏 · 原收藏会一直保留</text>
      <view v-if="editable" class="actions"><view @tap="editFavorite">编辑</view><view @tap="addImage">{{uploading?'上传中…':'添加图片'}}</view><view class="danger" @tap="askArchive">归档</view></view>
      <view v-if="canAccess(session,'favorites','EDIT')" class="convert"><view v-if="!convertOpen" class="secondary" @tap="startConvert">变成可继续编辑的草稿</view><template v-else><text class="card-title small-title">转换草稿</text><picker :range="conversions" range-key="label" :value="convertIndex" @change="convertIndex=Number($event.detail.value)"><view class="input">目标：{{conversions[convertIndex].label}}　›</view></picker><input v-model="convertTitle" class="input" placeholder="确认草稿标题"/><textarea v-model="convertDescription" class="textarea short-area" placeholder="补充说明（可选）"/><text class="note">转成菜谱时不猜食材和做法，也不会自动发布；请进入草稿后自己补全。</text><view class="primary" :class="{disabled:busy}" @tap="runConvert">{{busy?'创建中…':'确认创建草稿'}}</view></template></view>
    </view>
  </view>
</template>

<style scoped>
.page{min-height:100vh;padding:36rpx 28rpx 70rpx;background:linear-gradient(180deg,#fff3cf,#f7f3e8 35%)}.eyebrow,.title,.subtitle,.favorite-title,.meta,.card-title,.detail-title,.body,.owner,.note,.empty{display:block}.eyebrow{color:#bd8a49;font-size:20rpx;letter-spacing:3rpx}.title{margin-top:8rpx;color:#66523b;font-size:42rpx;font-weight:700}.subtitle{margin-top:10rpx;color:#9b8c79;font-size:22rpx}.favorite,.card{margin-top:16rpx;padding:22rpx;border:3rpx solid #fffdf6;border-radius:25rpx;background:#fffdf8;box-shadow:0 8rpx 18rpx rgba(112,91,61,.06)}.favorite{display:flex;align-items:center;gap:16rpx}.stamp{display:flex;align-items:center;justify-content:center;width:66rpx;height:66rpx;border-radius:20rpx;background:#fff0bd;font-size:34rpx}.grow{min-width:0;flex:1}.favorite-title{color:#625648;font-size:27rpx}.meta{margin-top:7rpx;color:#9b9185;font-size:19rpx}.tags{display:flex;flex-wrap:wrap;gap:9rpx;margin-top:8rpx}.tags text{padding:4rpx 9rpx;border-radius:9rpx;background:#eef1d9;color:#78805e;font-size:17rpx}.tags.large{margin-top:20rpx}.go{font-size:38rpx;color:#c8bba8}.empty{padding:80rpx 0 45rpx;color:#9a9185;text-align:center;font-size:23rpx}.primary,.secondary{margin-top:22rpx;padding:21rpx;border-radius:20rpx;background:#e3a64e;color:#fff;text-align:center;font-size:25rpx}.secondary{background:#eaf1d9;color:#6b7953}.disabled{opacity:.55}.back{display:block;margin-bottom:16rpx;color:#a47740;font-size:22rpx}.card-title{color:#665744;font-size:30rpx;font-weight:650}.input,.textarea{box-sizing:border-box;width:100%;margin-top:13rpx;padding:18rpx;border:2rpx solid #eee4d3;border-radius:15rpx;background:#fff;color:#655b50;font-size:23rpx}.textarea{height:150rpx}.short-area{height:105rpx}.cancel{padding:18rpx;text-align:center;color:#9a9187;font-size:22rpx}.badges{display:flex;gap:9rpx}.badges text{padding:7rpx 11rpx;border-radius:11rpx;background:#fff0c6;color:#98703d;font-size:18rpx}.detail-title{margin-top:18rpx;color:#5d5143;font-size:36rpx;font-weight:700}.body{margin-top:18rpx;color:#70675d;font-size:24rpx;line-height:1.7;white-space:pre-wrap}.link{display:flex;gap:15rpx;justify-content:space-between;margin-top:18rpx;padding:16rpx;border-radius:14rpx;background:#f4f0e8;color:#8f714f;font-size:20rpx;word-break:break-all}.link text{flex:none;color:#bf833a}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9rpx;margin-top:18rpx}.photo{width:100%;height:190rpx;border-radius:15rpx;background:#eee}.owner{margin-top:21rpx;color:#a0988c;font-size:19rpx}.actions{display:flex;gap:9rpx;margin-top:18rpx}.actions view{flex:1;padding:15rpx;border-radius:14rpx;background:#f0eadf;color:#88725a;text-align:center;font-size:20rpx}.actions .danger{background:#f8e5dc;color:#a36955}.convert{margin-top:22rpx;padding-top:8rpx;border-top:1rpx solid #efe8dd}.small-title{margin-top:17rpx;font-size:25rpx}.note{margin-top:14rpx;color:#9c8f7e;font-size:19rpx;line-height:1.55}
</style>
