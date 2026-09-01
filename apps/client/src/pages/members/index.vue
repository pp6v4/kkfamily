<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { canAccess, refreshAccess, type HouseholdContext } from '../../services/session';
import { createInvitation, listInvitations, listMembers, revokeInvitation, roleCatalog, saveMemberPermissions, setMemberStatus, transferAdmin, type Invitation, type Member, type Override } from '../../services/members-api';
const session = ref<HouseholdContext>(), members = ref<Member[]>([]), invitations = ref<Invitation[]>([]), selected = ref<Member>();
const busy = ref(false), error = ref(''), notice = ref(''), newCode = ref(''), nextCursor = ref<string | null>(null);
const roles = ref<string[]>([]), overrides = ref<Override[]>([]), catalog = ref<Record<string, Record<string, string>>>({});
const roleLabels: Record<string, string> = { ADMIN: '管理员', MEMBER: '家人', CHEF: '厨师', CAMPER: '露营协作者', GUEST: '普通访客' };
const modules: Array<[string, string]> = [['recipes','菜谱'],['meals','点餐'],['inventory','家中库存'],['shopping','购物'],['trips','露营行程'],['packing_templates','家庭行李模板'],['calendar','日历'],['members','成员管理'],['tasks','家庭待办'],['favorites','收藏灵感'],['archive','家庭档案'],['dashboard','看板'],['notifications','通知']];
const choices = ['继承角色', '禁止访问', '只读', '编辑', '管理'];
const manager = computed(() => canAccess(session.value, 'members', 'MANAGE'));
const preview = computed(() => {
  const result: Record<string, string> = {}, rank: Record<string, number> = { VIEW:1, EDIT:2, MANAGE:3 };
  for (const role of roles.value) for (const [module, level] of Object.entries(catalog.value[role] || {})) if ((rank[result[module]] || 0) < rank[level]) result[module] = level;
  for (const entry of overrides.value) { if (entry.effect === 'DENY') delete result[entry.module]; else result[entry.module] = entry.level; }
  return result;
});
function message(e: unknown) { return e instanceof Error ? e.message : '请求失败'; }
function copyCode() { if (newCode.value) uni.setClipboardData({ data: newCode.value }); }
async function load() {
  error.value = '';
  try {
    session.value = await refreshAccess();
    if (!canAccess(session.value, 'members')) { members.value = []; invitations.value = []; error.value = '尚未获准查看家庭成员，请联系管理员'; return; }
    const page = await listMembers(); members.value = page.items; nextCursor.value = page.nextCursor;
    if (manager.value) { [catalog.value, invitations.value] = await Promise.all([roleCatalog(), listInvitations()]); }
    else { selected.value = undefined; invitations.value = []; catalog.value = {}; }
  } catch (e) { members.value = []; invitations.value = []; error.value = message(e); }
}
async function more() { if (!nextCursor.value) return; try { const page = await listMembers(nextCursor.value); members.value.push(...page.items); nextCursor.value = page.nextCursor; } catch(e) { error.value=message(e); } }
function edit(member: Member) { if (!manager.value) return; selected.value = member; roles.value = [...member.roles]; overrides.value = member.overrides.map(g => ({ ...g })); error.value = ''; }
function toggleRole(code: string) { roles.value = roles.value.includes(code) ? roles.value.filter(r => r !== code) : [...roles.value, code]; }
function permissionIndex(module: string) { const item = overrides.value.find(g => g.module === module); return !item ? 0 : item.effect === 'DENY' ? 1 : ['VIEW','EDIT','MANAGE'].indexOf(item.level) + 2; }
function permissionChange(module: string, event: { detail: { value: string } }) {
  const index = Number(event.detail.value); overrides.value = overrides.value.filter(g => g.module !== module);
  if (index) overrides.value.push({ module, effect: index === 1 ? 'DENY' : 'ALLOW', level: index <= 2 ? 'VIEW' : index === 3 ? 'EDIT' : 'MANAGE' });
}
async function action(run: () => Promise<unknown>, success: string) {
  if (busy.value) return; busy.value=true; error.value=''; notice.value='';
  try { await run(); notice.value=success; await load(); }
  catch(e) { error.value=message(e)+'；草稿已保留。若提示版本冲突，请刷新成员后重新编辑。'; }
  finally { busy.value=false; }
}
async function save() { const member=selected.value; if (!member) return; await action(async()=>{ await saveMemberPermissions(member,roles.value,overrides.value); selected.value=undefined; },'权限已保存，后端后续请求会重新校验'); }
function invite(kind: 'family'|'dining'|'camping') {
  const input = kind === 'family' ? { roles:['MEMBER'], grants:[] } : kind === 'dining' ? { roles:['GUEST'], grants:[{module:'recipes',level:'VIEW',effect:'ALLOW'},{module:'meals',level:'EDIT',effect:'ALLOW'}] } : { roles:['CAMPER'],grants:[] };
  action(async()=>{ const result=await createInvitation(input.roles,input.grants as Override[]); newCode.value=result.code || ''; },'单次邀请码已创建，有效48小时；只在此显示一次');
}
function confirmChange(member: Member, transfer = false) {
  uni.showModal({ title: transfer ? '转让管理员' : member.status === 'ACTIVE' ? '停用此成员' : '启用此成员', content: transfer ? '目标成为管理员，你将失去管理员角色。其他显式权限保留。确定继续？' : '将修改此成员的家庭访问状态，后台会保护最后一名管理员。', success: result => {
    if (!result.confirm) return;
    action(()=>transfer ? transferAdmin(member, session.value!.version!) : setMemberStatus(member, member.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'),'成员已更新');
  } });
}
function revoke(invitation: Invitation) { uni.showModal({title:'撤销邀请码',content:'仅阻止后续兑换，不移除已经加入的成员。',success:r=>{if(r.confirm)action(()=>revokeInvitation(invitation),'邀请码已撤销');}}); }
onShow(load);
</script>
<template>
  <view class="page"><text class="title">家人和权限</text><text class="hint">一个账号可以有多个角色。禁止规则优先；行程还需单独加入才能查看。</text>
    <view v-if="error" class="error">{{ error }}</view><view v-if="notice" class="notice">{{ notice }}</view><button size="mini" :disabled="busy" @tap="load">刷新成员</button>
    <view v-if="manager" class="card"><text class="heading">邀请来我们家</text><view class="row"><button :disabled="busy" @tap="invite('family')">邀请家人</button><button :disabled="busy" @tap="invite('dining')">只来点菜</button><button :disabled="busy" @tap="invite('camping')">一起露营</button></view><text class="hint">露营邀请只授予模块权限，尚需行程管理者把成员加入指定行程。</text><view v-if="newCode" class="code"><text selectable>{{ newCode }}</text><button size="mini" @tap="copyCode">复制邀请码</button></view></view>
    <view v-for="(member,index) in members" :key="member.id" class="card"><text class="heading">{{ member.user.nickname || `家庭成员 ${index+1}` }}{{ member.id===session?.membershipId?'（我）':'' }}</text><view v-if="manager"><text class="hint">{{ member.roles.map(r=>roleLabels[r]||r).join('、') || '无角色' }} · {{ member.status }}</text><view class="row"><button :disabled="busy" @tap="edit(member)">编辑角色与权限</button><button :disabled="busy" @tap="confirmChange(member)">{{member.status==='ACTIVE'?'停用':'启用'}}</button><button v-if="session?.roles.includes('ADMIN') && member.id!==session.membershipId && member.status==='ACTIVE'" :disabled="busy" @tap="confirmChange(member,true)">转让管理员</button></view></view></view>
    <button v-if="nextCursor" @tap="more">更多成员</button>
    <view v-if="selected && manager" class="card"><text class="heading">编辑角色和权限</text><view class="row"><button v-for="(label,code) in roleLabels" :key="code" :class="{chosen:roles.includes(code)}" @tap="toggleRole(code)">{{roles.includes(code)?'✓ ':''}}{{label}}</button></view><view v-for="[module,label] in modules" :key="module" class="permission"><text>{{label}}</text><picker :range="choices" :value="permissionIndex(module)" @change="permissionChange(module,$event)"><text>{{choices[permissionIndex(module)]}} ›</text></picker><text class="hint">最终：{{preview[module] || '无访问权'}}</text></view><text class="hint">待办、收藏、档案、看板和通知的权限可配置，但对应业务仍待开发。</text><button :disabled="busy" :loading="busy" @tap="save">保存权限</button><button :disabled="busy" @tap="selected=undefined">取消编辑</button></view>
    <view v-if="manager && invitations.length" class="card"><text class="heading">最近邀请码</text><view v-for="item in invitations" :key="item.id" class="permission"><text>{{item.roleCodes.map(r=>roleLabels[r]||r).join('、')}} · 已用{{item.usedCount}}/{{item.maxUses}}</text><text class="hint">到期 {{item.expiresAt.slice(0,16)}} UTC</text><button v-if="!item.revokedAt" size="mini" :disabled="busy" @tap="revoke(item)">撤销</button><text v-else>已撤销</text></view></view>
  </view>
</template>
<style scoped>
.page{padding:36rpx 28rpx 80rpx;min-height:100vh;background:#f7f3e8;color:#334f3e}.title,.hint,.heading{display:block}.title{font-size:42rpx;font-weight:700}.hint{font-size:24rpx;color:#798174;line-height:1.7;margin:12rpx 0}.card{background:#fffdf7;padding:26rpx;border-radius:26rpx;margin:24rpx 0}.heading{font-size:30rpx;font-weight:600}.row{display:flex;flex-wrap:wrap;gap:12rpx;margin-top:18rpx}button{font-size:25rpx;background:#e2eddf;color:#3c674d;border-radius:16rpx;margin:8rpx 0}button.chosen{background:#4e9c78;color:white}.permission{padding:18rpx 0;border-bottom:1rpx solid #e7ebdf;font-size:27rpx}.permission picker{padding:14rpx;background:#f1f4ec;border-radius:12rpx;margin-top:10rpx}.error{color:#994818;background:#fff0dc;padding:20rpx;margin:18rpx 0;border-radius:16rpx}.notice{color:#386a4b;padding:18rpx}.code{word-break:break-all;padding:20rpx;background:#edf3e8;font-size:27rpx}
</style>
