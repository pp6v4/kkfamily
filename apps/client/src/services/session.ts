import { ApiError, rawRequest } from './transport';

const TOKEN_KEY = 'kkfamily.accessToken';
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

export function getStoredSession(): HouseholdContext | undefined {
  const value = uni.getStorageSync(CONTEXT_KEY) as HouseholdContext | undefined;
  const token = uni.getStorageSync(TOKEN_KEY) as string | undefined;
  return value?.householdId && token ? { ...value, accessToken: token } : undefined;
}

export function clearSession() {
  uni.removeStorageSync(TOKEN_KEY);
  uni.removeStorageSync(CONTEXT_KEY);
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
    if (token) {
      try { const profile = await rawRequest<{ user: LoginResult['user'] }>('/auth/me', 'GET', undefined, { Authorization: `Bearer ${token}` }); return { accessToken: token, user: profile.user }; }
      catch (error) { if (!(error instanceof Error && 'statusCode' in error && error.statusCode === 401)) throw error; clearSession(); }
    }
    const login = await rawRequest<LoginResult>('/auth/wechat/login', 'POST', { code: await loginCode() });
    uni.setStorageSync(TOKEN_KEY, login.accessToken);
    return login;
  })();
  try { return await pendingIdentity; } finally { pendingIdentity = undefined; }
}

export function canAccess(context: HouseholdContext | undefined, module: string, level: 'VIEW' | 'EDIT' | 'MANAGE' = 'VIEW') {
  const rank = { VIEW: 1, EDIT: 2, MANAGE: 3 };
  const assigned = context?.effectivePermissions?.[module];
  return assigned ? rank[assigned] >= rank[level] : false;
}

export async function refreshAccess() {
  const context = await ensureSession();
  try {
    const access = await rawRequest<{ roles: string[]; version: number; permissionVersion: number; effectivePermissions: HouseholdContext['effectivePermissions'] }>('/households/current/access', 'GET', undefined, { Authorization: `Bearer ${context.accessToken}`, 'X-Household-Id': context.householdId });
    const updated = { ...context, ...access };
    rememberSession(updated);
    return updated;
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 401) clearSession();
    else if (error instanceof ApiError && error.statusCode === 403) uni.removeStorageSync(CONTEXT_KEY);
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
    const login = await ensureIdentity();
    const membership = login.user.households.find((item) => item.status === 'ACTIVE');
    if (!membership) {
      if (!openingJoin) {
        openingJoin = true;
        uni.navigateTo({ url: '/pages/join/index', complete() { openingJoin = false; } });
      }
      throw new Error('请先创建家庭或输入管理员提供的邀请码');
    }
    const context: HouseholdContext = {
      householdId: membership.household.id,
      householdName: membership.household.name,
      membershipId: membership.membershipId,
      roles: membership.roles,
      accessToken: login.accessToken,
    };
    rememberSession(context);
    return context;
  })();
  try { return await pendingSession; } finally { pendingSession = undefined; }
}
