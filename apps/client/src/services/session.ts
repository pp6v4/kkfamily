import { ApiError, rawRequest } from './transport';

const TOKEN_KEY = 'kkfamily.accessToken';
const REFRESH_KEY = 'kkfamily.refreshToken';
const CONTEXT_KEY = 'kkfamily.householdContext';

export interface HouseholdContext {
  householdId: string;
  householdName: string;
  membershipId: string;
  roles: string[];
  accessToken: string;
  version?: number;
  permissionVersion?: number;
  effectivePermissions?: Record<string, 'VIEW' | 'EDIT' | 'MANAGE'>;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    nickname: string | null;
    avatarUrl: string | null;
    households: Array<{
      membershipId: string;
      household: { id: string; name: string };
      status: string;
      roles: string[];
    }>;
  };
}

let pendingSession: Promise<HouseholdContext> | undefined;
let pendingIdentity: Promise<LoginResult> | undefined;
let pendingIdentityRenewal: Promise<LoginResult> | undefined;
let openingJoin = false;
let sessionEpoch = 0;
let accessSequence = 0;
let renewedIdentity: LoginResult | undefined;
export function getSessionEpoch() { return sessionEpoch; }
export function assertSessionEpoch(epoch: number) {
  if (epoch !== sessionEpoch) throw new Error('登录会话已变化，请重新操作');
}
function invalidate() {
  ++sessionEpoch; ++accessSequence;
  pendingSession = undefined; pendingIdentity = undefined; pendingIdentityRenewal = undefined;
  renewedIdentity = undefined;
}

function loginCode() {
  return new Promise<string>((resolve, reject) => {
    uni.login({
      provider: 'weixin',
      success(result) { result.code ? resolve(result.code) : reject(new Error('微信登录未返回 code')); },
      fail(error) { reject(new Error(error.errMsg || '微信登录失败')); },
    });
  });
}

function storeTokens(login: LoginResult) {
  uni.setStorageSync(TOKEN_KEY, login.accessToken);
  uni.setStorageSync(REFRESH_KEY, login.refreshToken);
  renewedIdentity = login;
}

async function loginWithWechat(epoch = sessionEpoch) {
  const code = await loginCode(); assertSessionEpoch(epoch);
  const login = await rawRequest<LoginResult>('/auth/wechat/login', 'POST', { code });
  assertSessionEpoch(epoch);
  storeTokens(login);
  return login;
}

async function rotateRefreshToken(epoch: number) {
  const refreshToken = uni.getStorageSync(REFRESH_KEY) as string | undefined;
  if (!refreshToken) throw new ApiError('没有可续期的登录会话', 401);
  const login = await rawRequest<LoginResult>('/auth/refresh', 'POST', { refreshToken });
  assertSessionEpoch(epoch);
  storeTokens(login);
  return login;
}

export async function renewIdentity(failedAccessToken?: string) {
  if (failedAccessToken && renewedIdentity && renewedIdentity.accessToken !== failedAccessToken && uni.getStorageSync(TOKEN_KEY) === renewedIdentity.accessToken) return renewedIdentity;
  if (pendingIdentityRenewal) return pendingIdentityRenewal;
  const epoch = sessionEpoch;
  const pending = (async () => {
    try { return await rotateRefreshToken(epoch); }
    catch (error) {
      assertSessionEpoch(epoch);
      if (!(error instanceof ApiError && error.statusCode === 401)) throw error;
      clearStoredTokens();
      return loginWithWechat(epoch);
    }
  })();
  pendingIdentityRenewal = pending;
  try { return await pending; } finally { if (pendingIdentityRenewal === pending) pendingIdentityRenewal = undefined; }
}

function activeHousehold(login: LoginResult, preferredHouseholdId?: string, requirePreferred = false) {
  const active = login.user.households.filter(item => item.status === 'ACTIVE');
  const preferred = active.find(item => item.household.id === preferredHouseholdId);
  return preferred ?? (preferredHouseholdId && requirePreferred ? undefined : active[0]);
}

function contextFrom(login: LoginResult, preferredHouseholdId?: string, requirePreferred = false): HouseholdContext | undefined {
  const membership = activeHousehold(login, preferredHouseholdId, requirePreferred);
  if (!membership) return undefined;
  return {
    householdId: membership.household.id,
    householdName: membership.household.name,
    membershipId: membership.membershipId,
    roles: membership.roles,
    accessToken: login.accessToken,
  };
}

function openJoin() {
  if (openingJoin) return;
  openingJoin = true;
  uni.navigateTo({ url: '/pages/join/index', complete() { openingJoin = false; } });
}

function clearStoredTokens() {
  renewedIdentity = undefined;
  uni.removeStorageSync(TOKEN_KEY);
  uni.removeStorageSync(REFRESH_KEY);
  uni.removeStorageSync(CONTEXT_KEY);
}

export function getStoredSession(): HouseholdContext | undefined {
  const value = uni.getStorageSync(CONTEXT_KEY) as HouseholdContext | undefined;
  const token = uni.getStorageSync(TOKEN_KEY) as string | undefined;
  return value?.householdId && token ? { ...value, accessToken: token } : undefined;
}

export function clearSession() {
  invalidate();
  clearStoredTokens();
}

export function rememberSession(context: HouseholdContext) {
  // Public calls select a household/account. Internal refreshes use commitSession.
  invalidate();
  commitSession(context);
}
function commitSession(context: HouseholdContext) {
  uni.setStorageSync(TOKEN_KEY, context.accessToken);
  uni.setStorageSync(CONTEXT_KEY, { ...context, accessToken: '' });
}

export async function ensureIdentity(): Promise<LoginResult> {
  if (pendingIdentity) return pendingIdentity;
  const epoch = sessionEpoch;
  const pending = (async () => {
    const token = uni.getStorageSync(TOKEN_KEY) as string | undefined;
    const refreshToken = uni.getStorageSync(REFRESH_KEY) as string | undefined;
    if (token) {
      try {
        const profile = await rawRequest<{ user: LoginResult['user'] }>('/auth/me', 'GET', undefined, { Authorization: `Bearer ${token}` });
        assertSessionEpoch(epoch);
        return { accessToken: uni.getStorageSync(TOKEN_KEY) || token, refreshToken: uni.getStorageSync(REFRESH_KEY) || refreshToken || '', user: profile.user };
      } catch (error) {
        assertSessionEpoch(epoch);
        if (!(error instanceof ApiError && error.statusCode === 401)) throw error;
      }
    }
    return refreshToken ? renewIdentity(token) : loginWithWechat(epoch);
  })();
  pendingIdentity = pending;
  try { return await pending; } finally { if (pendingIdentity === pending) pendingIdentity = undefined; }
}

export function canAccess(context: HouseholdContext | undefined, module: string, level: 'VIEW' | 'EDIT' | 'MANAGE' = 'VIEW') {
  const rank = { VIEW: 1, EDIT: 2, MANAGE: 3 };
  const assigned = context?.effectivePermissions?.[module];
  return assigned ? rank[assigned] >= rank[level] : false;
}

export async function identityRequest<T>(path: string, method: UniApp.RequestOptions['method'], data?: unknown) {
  const epoch = sessionEpoch;
  let identity = await ensureIdentity();
  assertSessionEpoch(epoch);
  try {
    const result = await rawRequest<T>(path, method, data, { Authorization: `Bearer ${identity.accessToken}` });
    assertSessionEpoch(epoch);
    return { data: result, identity };
  } catch (error) {
    assertSessionEpoch(epoch);
    if (!(error instanceof ApiError && error.statusCode === 401)) throw error;
    const renewed = await renewIdentity(identity.accessToken);
    assertSessionEpoch(epoch);
    if (identity.user.id && renewed.user.id && identity.user.id !== renewed.user.id) { clearSession(); throw new Error('登录账号已变化，请重新登录'); }
    identity = renewed;
    const result = await rawRequest<T>(path, method, data, { Authorization: `Bearer ${identity.accessToken}` });
    assertSessionEpoch(epoch);
    return { data: result, identity };
  }
}

export async function updateMyProfile(nickname: string) {
  const { data, identity } = await identityRequest<{ user: LoginResult['user'] }>('/auth/me', 'PATCH', { nickname });
  return { ...identity, user: data.user };
}

export async function renewSession(preferredHouseholdId?: string, failedAccessToken?: string) {
  const epoch = sessionEpoch, previous = getStoredSession();
  if (previous && preferredHouseholdId && previous.householdId !== preferredHouseholdId) throw new Error('当前家庭已变化，请重新操作');
  if (previous && failedAccessToken && previous.accessToken !== failedAccessToken) return previous;
  const login = await renewIdentity();
  assertSessionEpoch(epoch);
  const context = contextFrom(login, preferredHouseholdId, Boolean(preferredHouseholdId));
  if (!context) { invalidate(); uni.removeStorageSync(CONTEXT_KEY); openJoin(); throw new Error('请先创建家庭或输入管理员提供的邀请码'); }
  if (previous && previous.membershipId !== context.membershipId) { clearSession(); throw new Error('登录账号已变化，请重新登录'); }
  const updated = previous ? { ...previous, ...context } : context;
  commitSession(updated);
  return updated;
}

export async function logoutSession() {
  const refreshToken = uni.getStorageSync(REFRESH_KEY) as string | undefined;
  clearSession();
  if (refreshToken) await rawRequest('/auth/logout', 'POST', { refreshToken });
}

async function loadAccess(context: HouseholdContext, epoch: number, sequence: number) {
  const access = await rawRequest<{ roles: string[]; version: number; permissionVersion: number; effectivePermissions: HouseholdContext['effectivePermissions'] }>('/households/current/access', 'GET', undefined, { Authorization: `Bearer ${context.accessToken}`, 'X-Household-Id': context.householdId });
  assertSessionEpoch(epoch);
  if (sequence !== accessSequence) throw new Error('权限已重新刷新，请使用最新结果');
  const stored = getStoredSession();
  if (stored && stored.householdId === context.householdId && (stored.permissionVersion ?? 0) > access.permissionVersion) return stored;
  const updated = { ...context, ...access, accessToken: uni.getStorageSync(TOKEN_KEY) || context.accessToken };
  commitSession(updated);
  return updated;
}

export async function refreshAccess() {
  const epoch = sessionEpoch, sequence = ++accessSequence;
  let context = await ensureSession();
  assertSessionEpoch(epoch);
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await loadAccess(context, epoch, sequence); }
    catch (error) {
      assertSessionEpoch(epoch);
      if (sequence !== accessSequence) throw new Error('权限已重新刷新，请使用最新结果');
      if (attempt === 0 && error instanceof ApiError && error.statusCode === 401) {
        context = await renewSession(context.householdId, context.accessToken); assertSessionEpoch(epoch); continue;
      }
      if (error instanceof ApiError && error.statusCode === 403) { invalidate(); uni.removeStorageSync(CONTEXT_KEY); }
      throw error;
    }
  }
  throw new Error('权限刷新失败');
}

export async function ensureSession(force = false): Promise<HouseholdContext> {
  if (!force) {
    const stored = getStoredSession();
    if (stored) return stored;
  }
  if (pendingSession) return pendingSession;
  const epoch = sessionEpoch;
  const pending = (async () => {
    const preferred = getStoredSession()?.householdId;
    const login = await ensureIdentity();
    assertSessionEpoch(epoch);
    const context = contextFrom(login, preferred, Boolean(preferred));
    if (!context) { openJoin(); throw new Error('请先创建家庭或输入管理员提供的邀请码'); }
    commitSession(context);
    return context;
  })();
  pendingSession = pending;
  try { return await pending; } finally { if (pendingSession === pending) pendingSession = undefined; }
}
