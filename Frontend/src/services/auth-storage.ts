const AUTH_TOKEN_KEY = 'auth_token';
const USER_KEY = 'user';

const getSessionStorage = (): Storage | null => {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage;
};

const getLocalStorage = (): Storage | null => {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
};

const migrateLegacyAuth = (): void => {
  const session = getSessionStorage();
  const local = getLocalStorage();

  if (!session || !local) return;

  const sessionToken = session.getItem(AUTH_TOKEN_KEY);
  const sessionUser = session.getItem(USER_KEY);

  if (!sessionToken) {
    const legacyToken = local.getItem(AUTH_TOKEN_KEY);
    if (legacyToken) {
      session.setItem(AUTH_TOKEN_KEY, legacyToken);
    }
  }

  if (!sessionUser) {
    const legacyUser = local.getItem(USER_KEY);
    if (legacyUser) {
      session.setItem(USER_KEY, legacyUser);
    }
  }

  local.removeItem(AUTH_TOKEN_KEY);
  local.removeItem(USER_KEY);
};

export const authStorage = {
  getToken(): string | null {
    migrateLegacyAuth();
    return getSessionStorage()?.getItem(AUTH_TOKEN_KEY) ?? null;
  },

  setToken(token: string): void {
    const session = getSessionStorage();
    if (!session) return;

    session.setItem(AUTH_TOKEN_KEY, token);
    getLocalStorage()?.removeItem(AUTH_TOKEN_KEY);
  },

  getUser(): string | null {
    migrateLegacyAuth();
    return getSessionStorage()?.getItem(USER_KEY) ?? null;
  },

  setUser(user: unknown): void {
    const session = getSessionStorage();
    if (!session) return;

    session.setItem(USER_KEY, typeof user === 'string' ? user : JSON.stringify(user));
    getLocalStorage()?.removeItem(USER_KEY);
  },

  clearUser(): void {
    getSessionStorage()?.removeItem(USER_KEY);
    getLocalStorage()?.removeItem(USER_KEY);
  },

  clear(): void {
    getSessionStorage()?.removeItem(AUTH_TOKEN_KEY);
    getSessionStorage()?.removeItem(USER_KEY);
    getLocalStorage()?.removeItem(AUTH_TOKEN_KEY);
    getLocalStorage()?.removeItem(USER_KEY);
  },
};
