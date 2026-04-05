const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '');

const defaultApiBaseUrl = '/api';
const resolvedApiBaseUrl = normalizeBaseUrl(import.meta.env.VITE_API_URL || defaultApiBaseUrl);

const toWebSocketBaseUrl = (apiBaseUrl: string): string => {
  const explicitWsUrl = (import.meta.env.VITE_WS_URL || '').trim();
  if (explicitWsUrl) {
    return normalizeBaseUrl(explicitWsUrl);
  }

  if (apiBaseUrl.startsWith('http://') || apiBaseUrl.startsWith('https://')) {
    return normalizeBaseUrl(apiBaseUrl.replace(/^http/, 'ws').replace(/\/api\/?$/, ''));
  }

  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${protocol}://${window.location.host}`;
  }

  return '';
};

export const API_CONFIG = {
  BASE_URL: resolvedApiBaseUrl,
  WS_BASE_URL: toWebSocketBaseUrl(resolvedApiBaseUrl),
  TIMEOUT: Number(import.meta.env.VITE_API_TIMEOUT) || 30000,
};

export const API_ENDPOINTS = {
  AUTH: {
    LOGIN: '/auth/login',
    REGISTER: '/auth/register',
    VERIFY_OTP: '/auth/verify-otp',
    LOGOUT: '/auth/logout',
    FORGOT_PASSWORD: '/auth/forgot-password',
    RESET_PASSWORD: '/auth/reset-password',
    VERIFY_EMAIL: '/auth/verify-email',
    CHANGE_PASSWORD_REQUEST_OTP: '/auth/password/change/request-otp',
    CHANGE_PASSWORD_CONFIRM: '/auth/password/change/confirm',
    TWO_FA_ENABLE_REQUEST_OTP: '/auth/2fa/enable/request-otp',
    TWO_FA_ENABLE_CONFIRM: '/auth/2fa/enable/confirm',
    TWO_FA_DISABLE_REQUEST_OTP: '/auth/2fa/disable/request-otp',
    TWO_FA_DISABLE_CONFIRM: '/auth/2fa/disable/confirm',
  },

  INCIDENTS: {
    LIST: '/issues',
    CREATE: '/issues',
    REPORT: '/report',
    GET_BY_ID: (id: string) => `/issues/${id}`,
    LOGBOOK: (id: string) => `/issues/${id}/logbook`,
    UPDATE: (id: string) => `/issues/${id}`,
    DELETE: (id: string) => `/issues/${id}`,
    STATS: '/issues/stats',
  },

  TICKETS: {
    LIST: '/tickets',
    GET_BY_ID: (id: string) => `/tickets/${id}`,
    UPDATE_STATUS: (id: string) => `/tickets/${id}/status`,
    ASSIGN: (id: string) => `/tickets/${id}/assign`,
    ASSIGN_SUPERVISOR: (id: string) => `/tickets/${id}/assign-supervisor`,
    PROGRESS_UPDATE: (id: string) => `/tickets/${id}/progress-update`,
    LOGBOOK: (id: string) => `/tickets/${id}/logbook`,
    DELETE_LOGBOOK_ENTRY: (ticketId: string, entryId: string) => `/tickets/${ticketId}/logbook/${entryId}`,
    STATS: '/tickets/stats',
    CHAT_IDENTITY_KEY: '/tickets/chat/identity-key',
    CHAT_INBOX_SUMMARY: '/tickets/chat/inbox-summary',
    CHAT_OPTIONS: (id: string) => `/tickets/${id}/chat/options`,
    CHAT_SESSIONS: (id: string) => `/tickets/${id}/chat/sessions`,
    CHAT_SESSION_KEY: (ticketId: string, sessionId: string) => `/tickets/${ticketId}/chat/sessions/${sessionId}/crypto-key`,
    CHAT_MESSAGES: (ticketId: string, sessionId: string) => `/tickets/${ticketId}/chat/sessions/${sessionId}/messages`,
    CHAT_END: (ticketId: string, sessionId: string) => `/tickets/${ticketId}/chat/sessions/${sessionId}/end`,
    CHAT_DISCONNECT: (ticketId: string, sessionId: string) => `/tickets/${ticketId}/chat/sessions/${sessionId}/disconnect`,
    CHAT_TRANSCRIPT: (ticketId: string, sessionId: string) =>
      `/tickets/${ticketId}/chat/sessions/${sessionId}/transcript.pdf`,
  },

  MESSAGES: {
    LIST: (incidentId: string) => `/incidents/${incidentId}/messages`,
    SEND: (incidentId: string) => `/incidents/${incidentId}/messages`,
  },

  USERS: {
    PROFILE: '/users/profile',
    UPDATE_PROFILE: '/users/profile',
    WORKERS: '/users/workers',
    MANAGED_OFFICIALS: '/users/managed-officials',
  },

  ANALYTICS: {
    DASHBOARD: '/analytics/dashboard',
    HEATMAP: '/analytics/heatmap',
    TRENDS: '/analytics/trends',
  },
};
