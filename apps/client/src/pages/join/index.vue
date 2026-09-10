<script setup lang="ts">
import { computed, ref } from 'vue';
import { onHide, onShow, onUnload } from '@dcloudio/uni-app';
import { ensureIdentity, getSessionEpoch, identityRequest, logoutSession, rememberSession, updateMyProfile, type LoginResult } from '../../services/session';
import { ApiError } from '../../services/transport';
const name=ref('扣扣的家'),code=ref(''),error=ref(''),profileName=ref('');
const identity=ref<LoginResult>(),pageVisible=ref(false),loading=ref(false),writing=ref(false),signedOut=ref(false);
const selectedFamily=ref(false);
const busy=computed(()=>loading.value||writing.value);
let view=0,dialog=0,authorizedEpoch=-1,disposed=false;
function clearPrivate(){identity.value=undefined;code.value='';profileName.value='';name.value='扣扣的家';error.value='';authorizedEpoch=-1;selectedFamily.value=false;}
function capture(){return{view,epoch:getSessionEpoch(),userId:identity.value?.user.id};}
function current(scope:ReturnType<typeof capture>){
  if(disposed||!pageVisible.value||scope.view!==view)return false;
  if(scope.epoch!==getSessionEpoch()){++view;++dialog;clearPrivate();loading.value=false;error.value='登录会话已变化，请重新读取账号';return false;}
  return true;
}
function ready(){
  if(identity.value&&authorizedEpoch!==getSessionEpoch()){++view;++dialog;clearPrivate();error.value='登录会话已变化，请重新读取账号';return false;}
  return !busy.value&&!selectedFamily.value&&!!identity.value&&pageVisible.value&&!disposed;
}
function fail(e:unknown){
  if(e instanceof ApiError&&[401,403].includes(e.statusCode)){clearPrivate();++dialog;}
  error.value=e instanceof Error?e.message:'操作失败，请重试';
}
async function login(){
  if(disposed||!pageVisible.value||writing.value)return;
  ++view;++dialog;clearPrivate();signedOut.value=false;loading.value=true;const scope=capture();
  try{const result=await ensureIdentity();if(!current(scope))return;identity.value=result;profileName.value=result.user.nickname||'';authorizedEpoch=getSessionEpoch();}
  catch(e){if(current(scope))fail(e);}finally{if(scope.view===view)loading.value=false;}
}
function matching(scope:ReturnType<typeof capture>,result:LoginResult){if(!current(scope))return false;if(scope.userId&&result.user.id!==scope.userId){clearPrivate();error.value='登录账号已变化，请重新读取';return false;}return true;}
function navigate(){
  const scope=capture();
  uni.switchTab({url:'/pages/profile/index',fail:()=>{if(current(scope))error.value='家庭已选定，但页面跳转失败，请返回“我的家”或重新读取账号';}});
}
function finish(scope:ReturnType<typeof capture>){
  writing.value=false;
  if(!disposed&&pageVisible.value&&scope.view!==view&&scope.epoch===getSessionEpoch()){
    ++view;clearPrivate();loading.value=false;error.value='离开前的操作已结束，请重新读取账号确认结果';
  }
}
async function submit(action:'create'|'join'){
  if(!ready())return;
  const familyName=name.value.trim(),inviteCode=code.value.trim();
  if(action==='create'&&(!familyName||familyName.length>40)){error.value='家庭名称须为1至40个字符';return;}
  if(action==='join'&&!/^[A-Za-z0-9_-]{32}$/.test(inviteCode)){error.value='请输入完整的32位邀请码';return;}
  if(!['create','join'].includes(action))return;
  const scope=capture();writing.value=true;++dialog;error.value='';
  try{
    if(action==='create'){
      const {data:family,identity:account}=await identityRequest<{id:string;name:string;membershipId:string}>('/households','POST',{name:familyName});
      if(!matching(scope,account))return;
      rememberSession({householdId:family.id,householdName:family.name,membershipId:family.membershipId,roles:['ADMIN'],accessToken:account.accessToken});
    }else{
      const {data:member,identity:account}=await identityRequest<{membershipId:string;roles:string[];household:{id:string;name:string}}>('/invitations/redeem','POST',{code:inviteCode});
      if(!matching(scope,account))return;
      rememberSession({householdId:member.household.id,householdName:member.household.name,membershipId:member.membershipId,roles:member.roles,accessToken:account.accessToken});
    }
    authorizedEpoch=getSessionEpoch();selectedFamily.value=true;code.value='';navigate();
  }catch(e){if(current(scope))fail(e);}finally{finish(scope);}
}
async function enterExisting(membershipId:string){
  if(!ready()||!identity.value?.user.households.some(m=>m.membershipId===membershipId&&m.status==='ACTIVE'))return;
  const scope=capture();writing.value=true;++dialog;error.value='';
  try{
    // Refresh account data before selecting a household; never reuse a stale bearer token.
    const account=await ensureIdentity();if(!matching(scope,account))return;
    const member=account.user.households.find(m=>m.membershipId===membershipId&&m.status==='ACTIVE');
    if(!member){identity.value=account;error.value='该家庭成员资格已变化，请重新选择';return;}
    rememberSession({householdId:member.household.id,householdName:member.household.name,membershipId:member.membershipId,roles:member.roles,accessToken:account.accessToken});
    authorizedEpoch=getSessionEpoch();selectedFamily.value=true;navigate();
  }catch(e){if(current(scope))fail(e);}finally{finish(scope);}
}
function logout(){
  if(!ready())return;
  const scope=capture(),confirmation=++dialog;
  uni.showModal({title:'退出当前登录',content:'将清除本机登录，并尝试撤销远端会话；不会退出家庭或删除数据。',success:async result=>{
    if(!result.confirm||confirmation!==dialog||!current(scope)||!ready())return;
    ++dialog;writing.value=true;signedOut.value=true;clearPrivate();
    // logoutSession invalidates the local session synchronously, before network I/O.
    const pending=logoutSession(),after=capture();
    try{await pending;if(current(after))uni.showToast({title:'本机已退出',icon:'success'});}
    catch(e){if(current(after))error.value='本机已退出，但远端会话撤销未确认：'+(e instanceof Error?e.message:'网络异常');}
    finally{writing.value=false;}
  }});
}
async function saveProfile(){
  if(!ready())return;
  const nickname=profileName.value.trim();if(!nickname||nickname.length>30){error.value='显示名须为1至30个字符';return;}
  const scope=capture();writing.value=true;++dialog;error.value='';
  try{const result=await updateMyProfile(nickname);if(!matching(scope,result))return;identity.value=result;profileName.value=result.user.nickname||'';uni.showToast({title:'显示名已保存',icon:'success'});}
  catch(e){if(current(scope))fail(e);}finally{finish(scope);}
}
function leave(){pageVisible.value=false;++view;++dialog;clearPrivate();loading.value=false;}
onShow(()=>{if(disposed)return;pageVisible.value=true;if(signedOut.value||writing.value){clearPrivate();return;}return login();});
onHide(leave);onUnload(()=>{disposed=true;leave();});
</script>
<template>
  <view class="page"><text class="eyebrow">扣扣的家</text><text class="title">欢迎回家 🏡</text><text class="hint">微信只确认你的身份。加入同一个家庭后，才会共享菜谱与行程。</text>
    <text v-if="busy" class="hint">{{writing?'正在处理，请稍候…':'正在读取微信账号…'}}</text>
    <button :disabled="busy" @tap="login">{{signedOut?'重新登录':identity?'重新读取账号':'微信登录'}}</button>
    <view v-if="error" class="error">{{ error }}</view>
    <view v-if="identity" class="card"><text class="heading">我的账号</text><input :disabled="busy||!identity||selectedFamily" v-model="profileName" type="nickname" maxlength="30" placeholder="设置家人能认出的显示名" /><text class="hint">显示名用于点餐、待办负责人和露营分工；不会用昵称搜索或授权账号。</text><button :disabled="busy||!identity||selectedFamily" :loading="busy" @tap="saveProfile">保存显示名</button></view>
    <view v-for="family in identity?.user.households.filter(h => h.status === 'ACTIVE')" :key="family.membershipId" class="card"><text>{{ family.household.name }}</text><button :disabled="busy||!identity||selectedFamily" @tap="enterExisting(family.membershipId)">进入已有家庭</button></view>
    <view class="card"><text class="heading">家人已经创建好了？</text><input :disabled="busy||!identity||selectedFamily" v-model="code" maxlength="32" placeholder="粘贴管理员提供的邀请码" /><text class="hint">邀请码只用于加入家庭，不会自动开放所有功能。</text><button :disabled="busy||!identity||selectedFamily" :loading="busy" @tap="submit('join')">加入家庭</button></view>
    <view class="card"><text class="heading">第一次使用</text><input :disabled="busy||!identity||selectedFamily" v-model="name" maxlength="40" placeholder="给家庭起个名字" /><text class="hint">只有点击下方按钮才会创建新家庭；夫妻共用时只需一人创建。</text><button :disabled="busy||!identity||selectedFamily" @tap="submit('create')">创建新家庭</button></view>
    <view v-if="identity" class="logout" @tap="logout">退出当前登录</view>
  </view>
</template>
<style scoped>
.page{padding:40rpx 30rpx;min-height:100vh;background:#f7f3e8;color:#334f3e}.eyebrow,.title,.hint,.heading{display:block}.eyebrow{color:#78927d;letter-spacing:4rpx}.title{font-size:44rpx;font-weight:700;margin:16rpx 0}.hint{font-size:25rpx;color:#787e72;line-height:1.7;margin:14rpx 0}.card{background:#fffdf7;padding:28rpx;border-radius:28rpx;margin-top:26rpx}.heading{font-size:31rpx;font-weight:600}input{background:#f1f3ed;border-radius:16rpx;padding:20rpx;margin:20rpx 0;font-size:28rpx}button{background:#4e9c78;color:white;font-size:28rpx;border-radius:20rpx;margin-top:18rpx}.error{background:#fff0dc;color:#994818;padding:22rpx;border-radius:18rpx}.logout{margin:34rpx 0;text-align:center;color:#a36c65;font-size:24rpx}
</style>
