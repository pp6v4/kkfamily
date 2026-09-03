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
let pendingRenewal: Promise<HouseholdContext> | undefined;
let openingJoin = false;

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
}

async function loginWithWechat() {
  const login = await rawRequest<LoginResult>('/auth/wechat/login', 'POST', { code: await loginCode() });
  storeTokens(login);
  return login;
}

async function rotateRefreshToken() {
  const refreshToken = uni.getStorageSync(REFRESH_KEY) as string | undefined;
  if (!refreshToken) throw new ApiError('没有可续期的登录会话', 401);
  const login = await rawRequest<LoginResult>('/auth/refresh', 'POST', { refreshToken });
  storeTokens(login);
  return login;
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
  clearStoredTokens();
  pendingSession = undefined;
  pendingIdentity = undefined;
}

export function rememberSession(context: HouseholdContext) {
  uni.setStorageSync(TOKEN_KEY, context.accessToken);
  uni.setStorageSync(CONTEXT_KEY, { ...context, accessToken: '' });
}

export async function ensureIdentity(): Promise<LoginResult> {
  if (pendingIdentity) return pendingIdentity;
  pendingIdentity = (async () => {
    const token = uni.getStorageSync(TOKEN_KEY) as string | undefined;
    const refreshToken = uni.getStorageSync(REFRESH_KEY) as string | undefined;
    if (token) {
      try {
        const profile = await rawRequest<{ user: LoginResult['user'] }>('/auth/me', 'GET', undefined, { Authorization: `Bearer ${token}` });
        return { accessToken: token, refreshToken: refreshToken ?? '', user: profile.user };
      } catch (error) {
        if (!(error instanceof ApiError && error.statusCode === 401)) throw error;
      }
    }
    if (refreshToken) {
      try { return await rotateRefreshToken(); }
      catch (error) { if (!(error instanceof ApiError && error.statusCode === 401)) throw error; clearStoredTokens(); }
    }
    return loginWithWechat();
  })();
  try { return await pendingIdentity; } finally { pendingIdentity = undefined; }
}

export function canAccess(context: HouseholdContext | undefined, module: string, level: 'VIEW' | 'EDIT' | 'MANAGE' = 'VIEW') {
  const rank = { VIEW: 1, EDIT: 2, MANAGE: 3 };
  const assigned = context?.effectivePermissions?.[module];
  return assigned ? rank[assigned] >= rank[level] : false;
}

export async function renewSession(preferredHouseholdId?: string) {
  if (pendingRenewal) return pendingRenewal;
  pendingRenewal = (async () => {
    let login: LoginResult;
    try { login = await rotateRefreshToken(); }
    catch (error) {
      if (!(error instanceof ApiError && error.statusCode === 401)) throw error;
      clearStoredTokens();
      login = await loginWithWechat();
    }
    const context = contextFrom(login, preferredHouseholdId, Boolean(preferredHouseholdId));
    if (!context) { openJoin(); throw new Error('请先创建家庭或输入管理员提供的邀请码'); }
    rememberSession(context);
    return context;
  })();
  try { return await pendingRenewal; } finally { pendingRenewal = undefined; }
}

export async function logoutSession() {
  const refreshToken = uni.getStorageSync(REFRESH_KEY) as string | undefined;
  if (refreshToken) await rawRequest('/auth/logout', 'POST', { refreshToken });
  clearSession();
}

async function loadAccess(context: HouseholdContext) {
  const access = await rawRequest<{ roles: string[]; version: number; permissionVersion: number; effectivePermissions: HouseholdContext['effectivePermissions'] }>('/households/current/access', 'GET', undefined, { Authorization: `Bearer ${context.accessToken}`, 'X-Household-Id': context.householdId });
  const updated = { ...context, ...access };
  rememberSession(updated);
  return updated;
}

export async function refreshAccess() {
  const context = await ensureSession();
  try { return await loadAccess(context); }
  catch (error) {
    if (error instanceof ApiError && error.statusCode === 401) return loadAccess(await renewSession(context.householdId));
    if (error instanceof ApiError && error.statusCode === 403) uni.removeStorageSync(CONTEXT_KEY);
    throw error;
  }
}

export async function ensureSession(force = false): Promise<HouseholdContext> {
  if (!force) {
    const stored = getStoredSession();
    if (stored) return stored;
  }
  if (pendingSession) return pendingSession;
  pendingSession = (async () => {
    const preferred = getStoredSession()?.householdId;
    const login = await ensureIdentity();
    const context = contextFrom(login, preferred);
    if (!context) { openJoin(); throw new Error('请先创建家庭或输入管理员提供的邀请码'); }
    rememberSession(context);
    return context;
  })();
  try { return await pendingSession; } finally { pendingSession = undefined; }
}
