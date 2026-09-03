<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { ensureIdentity, logoutSession, rememberSession, type LoginResult } from '../../services/session';
import { rawRequest } from '../../services/transport';
const name = ref('扣扣的家'), code = ref(''), busy = ref(false), error = ref('');
const identity = ref<LoginResult>();
async function login() { error.value = ''; try { identity.value = await ensureIdentity(); } catch (e) { error.value = e instanceof Error ? e.message : '登录失败，请重试'; } }
async function submit(action: 'create' | 'join') {
  if (busy.value) return;
  if (action === 'create' && !name.value.trim() || action === 'join' && !code.value.trim()) { error.value = '请填写家庭名称或邀请码'; return; }
  busy.value = true; error.value = '';
  try {
    const current = await ensureIdentity();
    const headers = { Authorization: `Bearer ${current.accessToken}` };
    if (action === 'create') {
      const family = await rawRequest<{ id: string; name: string; membershipId: string }>('/households', 'POST', { name: name.value.trim() }, headers);
      rememberSession({ householdId: family.id, householdName: family.name, membershipId: family.membershipId, roles: ['ADMIN'], accessToken: current.accessToken });
    } else {
      const member = await rawRequest<{ membershipId: string; roles: string[]; household: { id: string; name: string } }>('/invitations/redeem', 'POST', { code: code.value.trim() }, headers);
      rememberSession({ householdId: member.household.id, householdName: member.household.name, membershipId: member.membershipId, roles: member.roles, accessToken: current.accessToken });
    }
    code.value = ''; uni.switchTab({ url: '/pages/profile/index' });
  } catch (e) { error.value = e instanceof Error ? e.message : '操作失败，填写内容已保留'; }
  finally { busy.value = false; }
}
function enterExisting(index: number) {
  const current = identity.value, member = current?.user.households.filter(h => h.status === 'ACTIVE')[index];
  if (!current || !member) return;
  rememberSession({ householdId: member.household.id, householdName: member.household.name, membershipId: member.membershipId, roles: member.roles, accessToken: current.accessToken });
  uni.switchTab({ url: '/pages/profile/index' });
}
function logout() {
  uni.showModal({ title: '退出当前登录', content: '将撤销本机当前登录会话，不会退出家庭或删除数据。', success: async result => {
    if (!result.confirm) return;
    try { await logoutSession(); identity.value = undefined; uni.showToast({ title: '已退出', icon: 'success' }); }
    catch (e) { error.value = e instanceof Error ? e.message : '退出失败'; }
  } });
}
onShow(login);
</script>
<template>
  <view class="page"><text class="eyebrow">扣扣的家</text><text class="title">欢迎回家 🏡</text><text class="hint">微信只确认你的身份。加入同一个家庭后，才会共享菜谱与行程。</text>
    <view v-if="error" class="error">{{ error }}<text @tap="login">　重新登录</text></view>
    <view v-for="(family, index) in identity?.user.households.filter(h => h.status === 'ACTIVE')" :key="family.membershipId" class="card"><text>{{ family.household.name }}</text><button @tap="enterExisting(index)">进入已有家庭</button></view>
    <view class="card"><text class="heading">家人已经创建好了？</text><input v-model="code" maxlength="32" placeholder="粘贴管理员提供的邀请码" /><text class="hint">邀请码只用于加入家庭，不会自动开放所有功能。</text><button :disabled="busy" :loading="busy" @tap="submit('join')">加入家庭</button></view>
    <view class="card"><text class="heading">第一次使用</text><input v-model="name" maxlength="40" placeholder="给家庭起个名字" /><text class="hint">只有点击下方按钮才会创建新家庭；夫妻共用时只需一人创建。</text><button :disabled="busy" @tap="submit('create')">创建新家庭</button></view>
    <view v-if="identity" class="logout" @tap="logout">退出当前登录</view>
  </view>
</template>
<style scoped>
.page{padding:40rpx 30rpx;min-height:100vh;background:#f7f3e8;color:#334f3e}.eyebrow,.title,.hint,.heading{display:block}.eyebrow{color:#78927d;letter-spacing:4rpx}.title{font-size:44rpx;font-weight:700;margin:16rpx 0}.hint{font-size:25rpx;color:#787e72;line-height:1.7;margin:14rpx 0}.card{background:#fffdf7;padding:28rpx;border-radius:28rpx;margin-top:26rpx}.heading{font-size:31rpx;font-weight:600}input{background:#f1f3ed;border-radius:16rpx;padding:20rpx;margin:20rpx 0;font-size:28rpx}button{background:#4e9c78;color:white;font-size:28rpx;border-radius:20rpx;margin-top:18rpx}.error{background:#fff0dc;color:#994818;padding:22rpx;border-radius:18rpx}.logout{margin:34rpx 0;text-align:center;color:#a36c65;font-size:24rpx}
</style>
