import { rawRequest } from './transport';

const TOKEN_KEY = 'kkfamily.accessToken';
const CONTEXT_KEY = 'kkfamily.householdContext';

export interface HouseholdContext {
  householdId: string;
  householdName: string;
  membershipId: string;
  roles: string[];
  accessToken: string;
}

interface LoginResult {
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
}

export async function ensureSession(force = false): Promise<HouseholdContext> {
  if (!force) {
    const stored = getStoredSession();
    if (stored) return stored;
  }
  if (pendingSession) return pendingSession;
  pendingSession = (async () => {
    const code = await loginCode();
    const login = await rawRequest<LoginResult>('/auth/wechat/login', 'POST', { code });
    let membership = login.user.households.find((item) => item.status === 'ACTIVE');
    if (!membership) {
      const household = await rawRequest<{ id: string; name: string; membershipId: string }>('/households', 'POST', { name: '扣扣的家' }, { Authorization: `Bearer ${login.accessToken}` });
      membership = { membershipId: household.membershipId, household, status: 'ACTIVE', roles: ['ADMIN'] };
    }
    const context: HouseholdContext = {
      householdId: membership.household.id,
      householdName: membership.household.name,
      membershipId: membership.membershipId,
      roles: membership.roles,
      accessToken: login.accessToken,
    };
    uni.setStorageSync(TOKEN_KEY, context.accessToken);
    uni.setStorageSync(CONTEXT_KEY, { ...context, accessToken: '' });
    return context;
  })();
  try { return await pendingSession; } finally { pendingSession = undefined; }
}
