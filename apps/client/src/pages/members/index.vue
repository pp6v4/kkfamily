<script setup lang="ts">
import { computed, ref } from 'vue';
import { onHide, onShow, onUnload } from '@dcloudio/uni-app';
import { canAccess, getStoredSession, refreshAccess, type HouseholdContext } from '../../services/session';
import { ApiError } from '../../services/transport';
import { createInvitation, listInvitations, listMembers, revokeInvitation, roleCatalog, saveMemberPermissions, setMemberStatus, transferAdmin, type Invitation, type Member, type Override } from '../../services/members-api';
const session = ref<HouseholdContext>(), members = ref<Member[]>([]), invitations = ref<Invitation[]>([]), selected = ref<Member>();
const loading=ref(false),writing=ref(false),paging=ref(false),pageVisible=ref(false),reloadRequired=ref(false);
const busy=computed(()=>loading.value||writing.value||paging.value);
const error = ref(''), notice = ref(''), newCode = ref(''), nextCursor = ref<string | null>(null);
const roles = ref<string[]>([]), overrides = ref<Override[]>([]), catalog = ref<Record<string, Record<string, string>>>({});
let epoch=0,editEpoch=0,confirmationEpoch=0,disposed=false;
const roleLabels: Record<string, string> = { ADMIN: '管理员', MEMBER: '家人', CHEF: '厨师', CAMPER: '露营协作者', GUEST: '普通访客' };
const modules: Array<[string, string]> = [['recipes','菜谱'],['meals','点餐'],['inventory','家中库存'],['shopping','购物'],['trips','露营行程'],['packing_templates','家庭行李模板'],['calendar','日历'],['members','成员管理'],['tasks','家庭待办'],['favorites','收藏灵感'],['archive','家庭档案'],['dashboard','看板'],['notifications','通知']];
const choices = ['继承角色', '禁止访问', '只读', '编辑', '管理'];
const manager = computed(() => canAccess(session.value, 'members', 'MANAGE'));
const preview = computed(() => {
  const result: Record<string, string> = {}, rank: Record<string, number> = { VIEW:1, EDIT:2, MANAGE:3 };
  for (const role of roles.value) for (const [module, level] of Object.entries(catalog.value[role] || {})) if ((rank[result[module]] || 0) < rank[level]) result[module] = level;
  for (const entry of overrides.value) if(entry.effect==='ALLOW')result[entry.module]=entry.level;
  for (const entry of overrides.value) if(entry.effect==='DENY')delete result[entry.module];
  return result;
});
function message(e:unknown){return e instanceof Error?e.message:'请求失败';}
function identity(value?:HouseholdContext){return value?value.householdId+':'+value.membershipId:'';}
function clearEditor(){++editEpoch;selected.value=undefined;roles.value=[];overrides.value=[];}
function clearPrivate(){clearEditor();members.value=[];invitations.value=[];catalog.value={};session.value=undefined;newCode.value='';nextCursor.value=null;error.value='';notice.value='';reloadRequired.value=false;}
function current(token:number,owner:string){
  if(disposed||!pageVisible.value||token!==epoch)return false;
  if(identity(getStoredSession())!==owner){++epoch;clearPrivate();loading.value=false;paging.value=false;error.value='账号或家庭已变化，请刷新';return false;}
  return true;
}
function fail(e:unknown){
  if(e instanceof ApiError&&[401,403].includes(e.statusCode)){++epoch;clearPrivate();loading.value=false;paging.value=false;}
  error.value=message(e);
}
function ready(level:'VIEW'|'MANAGE'='MANAGE'){
  if(busy.value||reloadRequired.value||!current(epoch,identity(session.value)))return false;
  if(!canAccess(session.value,'members',level)||!canAccess(getStoredSession(),'members',level)){fail(new ApiError('尚未获得成员'+(level==='VIEW'?'查看':'管理')+'权限',403));return false;}
  return true;
}
function copyCode(){if(ready()&&newCode.value)uni.setClipboardData({data:newCode.value});}
async function read(token:number,owner:string){
  const access=await refreshAccess();if(!current(token,owner))return;
  if(identity(access)!==owner)throw new Error('账号或家庭已变化，请刷新');
  session.value=access;
  if(!canAccess(access,'members')){clearPrivate();session.value=access;error.value='尚未获准查看家庭成员，请联系管理员';return;}
  const admin=canAccess(access,'members','MANAGE');
  const [page,defaults,invites]=await Promise.all([listMembers(),admin?roleCatalog():Promise.resolve({}),admin?listInvitations():Promise.resolve([])]);
  if(!current(token,owner))return;
  members.value=page.items;nextCursor.value=page.nextCursor;catalog.value=defaults;invitations.value=invites;reloadRequired.value=false;
  if(!admin){clearEditor();newCode.value='';}
}
async function load(){
  if(disposed||!pageVisible.value)return;
  const token=++epoch,owner=identity(getStoredSession());clearPrivate();loading.value=true;paging.value=false;++confirmationEpoch;
  try{await read(token,owner);}catch(e){if(current(token,owner)){clearPrivate();reloadRequired.value=true;fail(e);}}
  finally{if(token===epoch)loading.value=false;}
}
async function more(){
  if(!nextCursor.value||!ready('VIEW'))return;
  const token=epoch,owner=identity(session.value),cursor=nextCursor.value;paging.value=true;
  try{
    const page=await listMembers(cursor);if(!current(token,owner)||nextCursor.value!==cursor)return;
    const rows=new Map(members.value.map(row=>[row.id,row]));
    for(const row of page.items){const old=rows.get(row.id);if(!old||row.version>=old.version)rows.set(row.id,row);}
    members.value=[...rows.values()];nextCursor.value=page.nextCursor;
  }catch(e){if(current(token,owner))fail(e);}
  finally{if(token===epoch)paging.value=false;}
}
function cancelEdit(){if(busy.value)return;clearEditor();++confirmationEpoch;}
function findMember(member:Member){return members.value.find(row=>row.id===member.id&&row.version===member.version);}
function edit(member:Member){
  if(!ready())return;const row=findMember(member);if(!row)return;
  clearEditor();++confirmationEpoch;selected.value={...row};roles.value=[...row.roles];overrides.value=row.overrides.map(value=>({...value}));error.value='';
}
function toggleRole(code:string){
  if(!ready()||!selected.value||!(code in roleLabels))return;
  if(code==='ADMIN'&&!session.value?.roles.includes('ADMIN')){error.value='仅管理员可授予管理员角色';return;}
  ++editEpoch;roles.value=roles.value.includes(code)?roles.value.filter(r=>r!==code):[...roles.value,code];
}
function permissionIndex(module:string){const item=overrides.value.find(g=>g.module===module);return !item?0:item.effect==='DENY'?1:['VIEW','EDIT','MANAGE'].indexOf(item.level)+2;}
function permissionChange(module:string,event:{detail:{value:string}}){
  if(!ready()||!selected.value||!modules.some(([code])=>code===module))return;
  const index=Number(event.detail.value);if(!Number.isInteger(index)||index<0||index>4)return;
  ++editEpoch;overrides.value=overrides.value.filter(g=>g.module!==module);
  if(index)overrides.value.push({module,effect:index===1?'DENY':'ALLOW',level:index<=2?'VIEW':index===3?'EDIT':'MANAGE'});
}
function capture(){return{token:epoch,owner:identity(session.value),editor:editEpoch,dialog:confirmationEpoch,actorVersion:session.value?.version};}
function valid(scope:ReturnType<typeof capture>){
  return current(scope.token,scope.owner)&&scope.editor===editEpoch&&scope.dialog===confirmationEpoch&&scope.actorVersion===session.value?.version&&scope.actorVersion===getStoredSession()?.version;
}
async function action<T>(run:()=>Promise<T>,success:string,done?:(value:T)=>void){
  if(!ready())return;
  const token=epoch,owner=identity(session.value);writing.value=true;++confirmationEpoch;error.value='';notice.value='';newCode.value='';let saved=false;
  try{
    const value=await run();saved=true;if(!current(token,owner))return;
    // Do not keep former administrator controls visible during permission refresh.
    clearPrivate();await read(token,owner);if(!current(token,owner))return;
    notice.value=success;if(manager.value)done?.(value);
  }catch(e){if(current(token,owner)){
    if(saved){clearPrivate();reloadRequired.value=true;fail(e instanceof ApiError&&[401,403].includes(e.statusCode)?e:new Error('操作已成功，但刷新失败；请刷新确认结果，不要重复提交。邀请码仅返回一次，必要时撤销后重新创建。'));}
    else{fail(e);if(!(e instanceof ApiError&&[401,403].includes(e.statusCode)))error.value+=(selected.value?'；草稿已保留':'')+'；若提示版本冲突，请刷新成员后重新编辑。';}
  }}finally{
    writing.value=false;
    if(!disposed&&pageVisible.value&&token!==epoch&&identity(session.value)===owner&&identity(getStoredSession())===owner){
      ++epoch;clearPrivate();loading.value=false;paging.value=false;reloadRequired.value=true;error.value='离开前的操作已结束，请刷新确认权限和成员状态';
    }
  }
}
async function save(){
  if(!ready())return;const member=selected.value;if(!member||!findMember(member))return;
  const snapshot={...member},codes=[...roles.value],grants=overrides.value.map(value=>({...value}));
  if(codes.some(code=>!(code in roleLabels))||new Set(codes).size!==codes.length||new Set(grants.map(g=>g.module)).size!==grants.length){error.value='角色或模块权限重复或无效';return;}
  if(codes.includes('ADMIN')&&!session.value?.roles.includes('ADMIN')){error.value='仅管理员可授予管理员角色';return;}
  await action(()=>saveMemberPermissions(snapshot,codes,grants),'权限已保存，后续请求使用最新授权');
}
async function invite(kind:'family'|'dining'|'camping'){
  if(!ready()||!['family','dining','camping'].includes(kind))return;
  const input=kind==='family'?{roles:['MEMBER'],grants:[]}:kind==='dining'?{roles:['GUEST'],grants:[{module:'recipes',level:'VIEW',effect:'ALLOW'},{module:'meals',level:'EDIT',effect:'ALLOW'}]}:{roles:['CAMPER'],grants:[]};
  await action(()=>createInvitation(input.roles,input.grants as Override[]),'单次邀请码已创建，有效48小时；离开页面后不再显示',result=>{newCode.value=result.code||'';});
}
function confirmChange(member:Member,transfer=false){
  if(!ready())return;const row=findMember(member);if(!row)return;
  if(transfer&&(!session.value?.roles.includes('ADMIN')||row.id===session.value.membershipId||row.status!=='ACTIVE'||!Number.isInteger(session.value.version))){error.value='请使用当前管理员账号，并选择其他有效成员';return;}
  ++confirmationEpoch;const scope=capture(),target={...row},actorVersion=session.value!.version!;
  uni.showModal({title:transfer?'转让管理员':row.status==='ACTIVE'?'停用此成员':'启用此成员',content:transfer?'目标成为管理员，你将失去管理员角色。其他显式权限保留。确定继续？':'将修改此成员的家庭访问状态，后台会保护最后一名管理员。',success:async result=>{
    if(!result.confirm||!valid(scope)||!ready()||!findMember(target))return;
    if(transfer&&!getStoredSession()?.roles.includes('ADMIN'))return;
    await action(()=>transfer?transferAdmin(target,actorVersion):setMemberStatus(target,target.status==='ACTIVE'?'DISABLED':'ACTIVE'),'成员已更新');
  }});
}
function revoke(invitation:Invitation){
  if(!ready())return;const row=invitations.value.find(value=>value.id===invitation.id&&value.version===invitation.version);if(!row||row.revokedAt)return;
  ++confirmationEpoch;const scope=capture(),target={...row};
  uni.showModal({title:'撤销邀请码',content:'仅阻止后续兑换，不移除已经加入的成员。',success:async result=>{
    if(!result.confirm||!valid(scope)||!ready()||!invitations.value.some(value=>value.id===target.id&&value.version===target.version&&!value.revokedAt))return;
    await action(()=>revokeInvitation(target),'邀请码已撤销');
  }});
}
function leave(){pageVisible.value=false;++epoch;++confirmationEpoch;clearPrivate();loading.value=false;paging.value=false;}
onShow(()=>{if(disposed)return;pageVisible.value=true;return load();});onHide(leave);onUnload(()=>{disposed=true;leave();});
</script>
<template>
  <view class="page"><text class="title">家人和权限</text><text class="hint">一个账号可以有多个角色。禁止规则优先；行程还需单独加入才能查看。</text>
    <text v-if="busy" class="hint">{{writing?'正在保存并核实权限…':paging?'正在加载更多成员…':'正在核实权限和成员…'}}</text>
    <view v-if="error" class="error">{{ error }}</view><view v-if="notice" class="notice">{{ notice }}</view><button size="mini" :disabled="busy" @tap="load">刷新成员</button>
    <view v-if="manager" class="card"><text class="heading">邀请来我们家</text><view class="row"><button :disabled="busy||reloadRequired" @tap="invite('family')">邀请家人</button><button :disabled="busy||reloadRequired" @tap="invite('dining')">只来点菜</button><button :disabled="busy||reloadRequired" @tap="invite('camping')">一起露营</button></view><text class="hint">露营邀请只授予模块权限，尚需行程管理者把成员加入指定行程。</text><view v-if="newCode" class="code"><text selectable>{{ newCode }}</text><button size="mini" @tap="copyCode">复制邀请码</button></view></view>
    <view v-for="(member,index) in members" :key="member.id" class="card"><text class="heading">{{ member.user.nickname || `家庭成员 ${index+1}` }}{{ member.id===session?.membershipId?'（我）':'' }}</text><view v-if="manager"><text class="hint">{{ member.roles.map(r=>roleLabels[r]||r).join('、') || '无角色' }} · {{ member.status }}</text><view class="row"><button :disabled="busy||reloadRequired" @tap="edit(member)">编辑角色与权限</button><button :disabled="busy||reloadRequired" @tap="confirmChange(member)">{{member.status==='ACTIVE'?'停用':'启用'}}</button><button v-if="session?.roles.includes('ADMIN') && member.id!==session.membershipId && member.status==='ACTIVE'" :disabled="busy||reloadRequired" @tap="confirmChange(member,true)">转让管理员</button></view></view></view>
    <button v-if="nextCursor" :disabled="busy||reloadRequired" @tap="more">更多成员</button>
    <view v-if="selected && manager" class="card"><text class="heading">编辑角色和权限</text><view class="row"><button :disabled="busy||reloadRequired||(code==='ADMIN'&&!session?.roles.includes('ADMIN'))" v-for="(label,code) in roleLabels" :key="code" :class="{chosen:roles.includes(code)}" @tap="toggleRole(code)">{{roles.includes(code)?'✓ ':''}}{{label}}</button></view><view v-for="[module,label] in modules" :key="module" class="permission"><text>{{label}}</text><picker :disabled="busy||reloadRequired" :range="choices" :value="permissionIndex(module)" @change="permissionChange(module,$event)"><text>{{choices[permissionIndex(module)]}} ›</text></picker><text class="hint">最终：{{preview[module] || '无访问权'}}</text></view><text class="hint">模块权限在服务端强制执行；通知的微信外部发送仍取决于正式模板授权。</text><button :disabled="busy||reloadRequired" :loading="busy" @tap="save">保存权限</button><button :disabled="busy||reloadRequired" @tap="cancelEdit">取消编辑</button></view>
    <view v-if="manager && invitations.length" class="card"><text class="heading">最近邀请码</text><view v-for="item in invitations" :key="item.id" class="permission"><text>{{item.roleCodes.map(r=>roleLabels[r]||r).join('、')}} · 已用{{item.usedCount}}/{{item.maxUses}}</text><text class="hint">到期 {{item.expiresAt.slice(0,16)}} UTC</text><button v-if="!item.revokedAt" size="mini" :disabled="busy||reloadRequired" @tap="revoke(item)">撤销</button><text v-else>已撤销</text></view></view>
  </view>
</template>
<style scoped>
.page{padding:36rpx 28rpx 80rpx;min-height:100vh;background:#f7f3e8;color:#334f3e}.title,.hint,.heading{display:block}.title{font-size:42rpx;font-weight:700}.hint{font-size:24rpx;color:#798174;line-height:1.7;margin:12rpx 0}.card{background:#fffdf7;padding:26rpx;border-radius:26rpx;margin:24rpx 0}.heading{font-size:30rpx;font-weight:600}.row{display:flex;flex-wrap:wrap;gap:12rpx;margin-top:18rpx}button{font-size:25rpx;background:#e2eddf;color:#3c674d;border-radius:16rpx;margin:8rpx 0}button.chosen{background:#4e9c78;color:white}.permission{padding:18rpx 0;border-bottom:1rpx solid #e7ebdf;font-size:27rpx}.permission picker{padding:14rpx;background:#f1f4ec;border-radius:12rpx;margin-top:10rpx}.error{color:#994818;background:#fff0dc;padding:20rpx;margin:18rpx 0;border-radius:16rpx}.notice{color:#386a4b;padding:18rpx}.code{word-break:break-all;padding:20rpx;background:#edf3e8;font-size:27rpx}
</style>
