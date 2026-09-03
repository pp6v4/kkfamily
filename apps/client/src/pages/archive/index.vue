<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { archiveArchiveField, createArchiveField, getArchiveValue, listArchiveFields, setArchiveValue, updateArchiveField, type ArchiveField, type ArchiveGrant } from '../../services/family-api';
import { listMembers, type Member } from '../../services/members-api';
import { canAccess, refreshAccess, type HouseholdContext } from '../../services/session';

const session=ref<HouseholdContext>(),fields=ref<ArchiveField[]>([]),members=ref<Member[]>([]),selected=ref<ArchiveField>(),showFieldForm=ref(false),editingField=ref(false),busy=ref(false);
const revealed=ref(false),value=ref(''),valueVersion=ref(0),editingValue=ref(false);
const form=ref({key:'',label:'',typeIndex:0,visibilityIndex:0,sensitive:false,grantModes:{} as Record<string,number>});
const types=[{value:'TEXT' as const,label:'文字'},{value:'DATE' as const,label:'日期'},{value:'CONTACT' as const,label:'联系人'},{value:'ADDRESS' as const,label:'地址'}];
const visibilities=[{value:'MANAGERS' as const,label:'仅管理员'},{value:'MEMBERS' as const,label:'家庭成员'},{value:'SELECTED' as const,label:'指定成员'}];
const manager=computed(()=>canAccess(session.value,'archive','MANAGE'));

function message(error:unknown){return error instanceof Error?error.message:'操作失败';}
function typeLabel(field:ArchiveField){return types.find(item=>item.value===field.valueType)?.label||field.valueType;}
function visibilityLabel(field:ArchiveField){return visibilities.find(item=>item.value===field.visibility)?.label||field.visibility;}
function formatTime(input:string|null){if(!input)return'尚未填写';const date=new Date(input);return`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function grantMode(memberId:string){return form.value.grantModes[memberId]||0;}
function cycleGrant(memberId:string){form.value.grantModes[memberId]=(grantMode(memberId)+1)%3;}
function grantLabel(memberId:string){return['不授权','可查看','可编辑'][grantMode(memberId)];}
function grants():ArchiveGrant[]{return Object.entries(form.value.grantModes).filter(([,mode])=>mode>0).map(([membershipId,mode])=>({membershipId,canRead:true,canEdit:mode===2}));}
async function load(){try{session.value=await refreshAccess();if(!canAccess(session.value,'archive'))return;fields.value=await listArchiveFields();if(manager.value&&canAccess(session.value,'members'))members.value=(await listMembers()).items;if(selected.value){const current=fields.value.find(field=>field.id===selected.value?.id);if(current)selected.value=current;else close();}}catch(error){uni.showToast({title:message(error),icon:'none'});}}
function open(field:ArchiveField){selected.value=field;showFieldForm.value=false;revealed.value=false;editingValue.value=false;value.value='';valueVersion.value=field.valueVersion;}
function close(){selected.value=undefined;showFieldForm.value=false;revealed.value=false;editingValue.value=false;}
function newField(){editingField.value=false;selected.value=undefined;showFieldForm.value=true;form.value={key:'',label:'',typeIndex:0,visibilityIndex:0,sensitive:false,grantModes:{}};}
function editField(){const field=selected.value;if(!field)return;editingField.value=true;showFieldForm.value=true;const modes:Record<string,number>={};for(const grant of field.grants||[])modes[grant.membershipId]=grant.canEdit?2:grant.canRead?1:0;form.value={key:field.key,label:field.label,typeIndex:Math.max(0,types.findIndex(item=>item.value===field.valueType)),visibilityIndex:Math.max(0,visibilities.findIndex(item=>item.value===field.visibility)),sensitive:field.sensitive,grantModes:modes};}
async function saveField(){if(!form.value.label.trim()||(!editingField.value&&!form.value.key.trim())){uni.showToast({title:'请填写字段名称和英文标识',icon:'none'});return;}busy.value=true;try{const common={label:form.value.label.trim(),valueType:types[form.value.typeIndex].value,sensitive:form.value.sensitive,visibility:visibilities[form.value.visibilityIndex].value,grants:grants()};const saved=editingField.value&&selected.value?await updateArchiveField(selected.value,common):await createArchiveField({key:form.value.key.trim(),...common});await load();open(saved);uni.showToast({title:'档案字段已保存',icon:'success'});}catch(error){uni.showToast({title:message(error),icon:'none',duration:3000});}finally{busy.value=false;}}
async function reveal(){const field=selected.value;if(!field)return false;busy.value=true;try{const result=await getArchiveValue(field.id);value.value=result.value||'';valueVersion.value=result.valueVersion;revealed.value=true;return true;}catch(error){uni.showToast({title:message(error),icon:'none'});return false;}finally{busy.value=false;}}
async function beginEdit(){if(!revealed.value&&!await reveal())return;editingValue.value=true;}
async function saveValue(){const field=selected.value;if(!field)return;busy.value=true;try{const result=await setArchiveValue(field.id,value.value,valueVersion.value);valueVersion.value=result.valueVersion;revealed.value=true;editingValue.value=false;await load();uni.showToast({title:'档案内容已加密保存',icon:'success'});}catch(error){uni.showToast({title:message(error),icon:'none',duration:3000});}finally{busy.value=false;}}
function askArchive(){const field=selected.value;if(!field)return;uni.showModal({title:'归档字段？',content:'字段和值会从家庭档案中隐藏，不进行物理删除。',success:async result=>{if(!result.confirm)return;try{await archiveArchiveField(field);close();await load();uni.showToast({title:'已归档',icon:'success'});}catch(error){uni.showToast({title:message(error),icon:'none'});}}});}
onShow(load);
</script>

<template>
  <view class="page">
    <view class="head"><text class="eyebrow">家庭档案</text><text class="title">重要的小事，安心放好</text><text class="subtitle">只展示你被授权查看的字段，内容默认不直接展开。</text></view>
    <template v-if="!selected&&!showFieldForm">
      <view v-for="field in fields" :key="field.id" class="field" @tap="open(field)"><view class="icon">{{field.valueType==='ADDRESS'?'📍':field.valueType==='CONTACT'?'☎️':field.valueType==='DATE'?'📅':'📄'}}</view><view class="grow"><text class="field-title">{{field.label}}</text><text class="meta">{{typeLabel(field)}} · {{visibilityLabel(field)}} · {{formatTime(field.updatedAt)}}</text></view><text v-if="field.sensitive" class="lock">🔒</text><text class="go">›</text></view>
      <text v-if="!fields.length" class="empty">当前没有你可以查看的档案字段。</text><view v-if="manager" class="primary" @tap="newField">＋ 新建档案字段</view>
    </template>
    <view v-if="showFieldForm" class="card">
      <text class="back" @tap="showFieldForm=false">‹ 返回</text><text class="card-title">{{editingField?'编辑字段和授权':'新建档案字段'}}</text>
      <input v-model="form.label" class="input" placeholder="字段名称，例如：家庭联系人"/><input v-if="!editingField" v-model="form.key" class="input" placeholder="英文标识，例如 family_contact"/>
      <picker :range="types" range-key="label" :value="form.typeIndex" @change="form.typeIndex=Number($event.detail.value)"><view class="input">内容类型：{{types[form.typeIndex].label}}　›</view></picker>
      <picker :range="visibilities" range-key="label" :value="form.visibilityIndex" @change="form.visibilityIndex=Number($event.detail.value)"><view class="input">默认可见：{{visibilities[form.visibilityIndex].label}}　›</view></picker>
      <view class="switch-row"><text>敏感内容（列表始终不返回明文）</text><switch :checked="form.sensitive" color="#739b82" @change="form.sensitive=$event.detail.value"/></view>
      <view v-if="members.length" class="grants"><text class="section-title">逐成员授权</text><view v-for="member in members" :key="member.id" class="grant" @tap="cycleGrant(member.id)"><text>{{member.user.nickname||'家庭成员'}}</text><text>{{grantLabel(member.id)}} ›</text></view><text class="note">“指定成员”按此处查看权限生效；非管理员要修改字段，必须单独授予“可编辑”。</text></view>
      <view class="primary" :class="{disabled:busy}" @tap="saveField">{{busy?'保存中…':'保存字段与授权'}}</view><view class="cancel" @tap="showFieldForm=false">取消</view>
    </view>
    <view v-if="selected&&!showFieldForm" class="card detail">
      <text class="back" @tap="close">‹ 返回档案</text><view class="badges"><text>{{typeLabel(selected)}}</text><text>{{visibilityLabel(selected)}}</text><text v-if="selected.sensitive">敏感</text></view><text class="detail-title">{{selected.label}}</text>
      <view class="value-box"><template v-if="!revealed"><text class="masked">{{selected.hasValue?'••••••••':'尚未填写'}}</text><view v-if="selected.hasValue" class="reveal" @tap="reveal">{{busy?'读取中…':'查看内容'}}</view></template><template v-else><textarea v-if="editingValue" v-model="value" class="textarea value-input" :placeholder="selected.valueType==='DATE'?'YYYY-MM-DD':'填写档案内容'"/><text v-else class="plain">{{value||'（空内容）'}}</text></template></view>
      <text class="note">查看和修改都会写入审计记录；审计中不保存内容明文。</text>
      <view v-if="selected.canEdit" class="primary" @tap="editingValue?saveValue():beginEdit()">{{busy?'处理中…':editingValue?'加密保存':'修改内容'}}</view>
      <view v-if="editingValue" class="cancel" @tap="editingValue=false">取消修改</view>
      <view v-if="manager" class="actions"><view @tap="editField">字段与授权</view><view class="danger" @tap="askArchive">归档字段</view></view>
    </view>
  </view>
</template>

<style scoped>
.page{min-height:100vh;padding:36rpx 28rpx 70rpx;background:linear-gradient(180deg,#e4f0e5,#f6f1e8 38%)}.eyebrow,.title,.subtitle,.field-title,.meta,.empty,.card-title,.section-title,.detail-title,.masked,.plain,.note{display:block}.eyebrow{color:#6f9479;font-size:20rpx;letter-spacing:3rpx}.title{margin-top:8rpx;color:#475e4d;font-size:41rpx;font-weight:700}.subtitle{margin-top:10rpx;color:#89958b;font-size:22rpx}.field,.card{margin-top:16rpx;padding:22rpx;border:3rpx solid #fffdf8;border-radius:25rpx;background:#fffdf8;box-shadow:0 8rpx 18rpx rgba(75,98,80,.06)}.field{display:flex;align-items:center;gap:15rpx}.icon{display:flex;align-items:center;justify-content:center;width:64rpx;height:64rpx;border-radius:20rpx;background:#deebdd;font-size:31rpx}.grow{min-width:0;flex:1}.field-title{color:#4d5d50;font-size:27rpx}.meta{margin-top:7rpx;color:#929a92;font-size:19rpx}.lock{font-size:22rpx}.go{color:#bdc4bb;font-size:37rpx}.empty{padding:80rpx 0 45rpx;color:#92998f;text-align:center;font-size:23rpx}.primary{margin-top:22rpx;padding:21rpx;border-radius:20rpx;background:#739b82;color:#fff;text-align:center;font-size:25rpx}.disabled{opacity:.55}.back{display:block;margin-bottom:16rpx;color:#63836d;font-size:22rpx}.card-title{color:#4c6352;font-size:30rpx;font-weight:650}.input,.textarea{box-sizing:border-box;width:100%;margin-top:13rpx;padding:18rpx;border:2rpx solid #e0e9df;border-radius:15rpx;background:#fff;color:#526057;font-size:23rpx}.textarea{height:150rpx}.switch-row,.grant{display:flex;align-items:center;justify-content:space-between;margin-top:14rpx;padding:15rpx;border-radius:14rpx;background:#f1f4ed;color:#647067;font-size:21rpx}.grants{margin-top:20rpx}.section-title{margin-bottom:8rpx;color:#506656;font-size:24rpx;font-weight:600}.note{margin-top:14rpx;color:#949b93;font-size:19rpx;line-height:1.55}.cancel{padding:18rpx;text-align:center;color:#929b93;font-size:22rpx}.badges{display:flex;gap:8rpx}.badges text{padding:7rpx 11rpx;border-radius:10rpx;background:#e5eee0;color:#66775f;font-size:18rpx}.detail-title{margin-top:18rpx;color:#46594b;font-size:36rpx;font-weight:700}.value-box{margin-top:20rpx;padding:24rpx;border-radius:18rpx;background:#f0f4ed}.masked{color:#69766c;font-size:30rpx;letter-spacing:7rpx}.plain{color:#4e5a51;font-size:25rpx;line-height:1.7;white-space:pre-wrap}.reveal{margin-top:16rpx;color:#63856e;font-size:21rpx}.value-input{margin-top:0}.actions{display:flex;gap:10rpx;margin-top:18rpx}.actions view{flex:1;padding:17rpx;border-radius:16rpx;background:#e7eee3;color:#62745f;text-align:center;font-size:21rpx}.actions .danger{background:#f6e4dd;color:#a26c59}
</style>
