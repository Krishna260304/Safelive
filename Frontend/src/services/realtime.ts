import { API_CONFIG } from '@/config/api';
import { authStorage } from './auth-storage';

const AUTH_TIMEOUT_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 12_000;
const STALE_CONNECTION_MS = 30_000;
const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 8_000;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export type RealtimeConnectionState = 'connecting' | 'connected' | 'fallback' | 'blocked' | 'closed';

interface RealtimeSubscriptionOptions {
  onMessage?: (payload: unknown) => void;
  onStateChange?: (state: RealtimeConnectionState) => void;
}

interface RealtimeSubscription {
  close: () => void;
}

interface RealtimeSubscriber {
  onMessage?: (payload: unknown) => void;
  onStateChange?: (state: RealtimeConnectionState) => void;
}

const isLoopbackHost = (hostname: string): boolean => LOOPBACK_HOSTS.has((hostname || '').trim().toLowerCase());

const isSecureBrowserContext = (): boolean => {
  if (typeof window === 'undefined') return true;
  return window.location.protocol === 'https:' || isLoopbackHost(window.location.hostname);
};

const isSecureWebSocketBase = (value: string): boolean => {
  const raw = (value || '').trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'wss:' || isLoopbackHost(parsed.hostname);
  } catch {
    return raw.startsWith('wss://');
  }
};

export const getRealtimeTransportSecurityError = (): string | null => {
  if (!API_CONFIG.WS_BASE_URL) return null;
  if (typeof window === 'undefined') return null;
  if (isSecureBrowserContext() && isSecureWebSocketBase(API_CONFIG.WS_BASE_URL)) {
    return null;
  }
  return 'Secure HTTPS/WSS transport is required for realtime chat outside localhost.';
};

const subscribers = new Map<number, RealtimeSubscriber>();
let nextSubscriberId = 0;
let sharedState: RealtimeConnectionState = 'closed';
let active = false;
let socket: WebSocket | null = null;
let authTimeoutId: number | null = null;
let heartbeatIntervalId: number | null = null;
let reconnectTimeoutId: number | null = null;
let reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
let lastHeartbeatAt = 0;
let authenticated = false;
let connectionToken = '';

const notifyState = (state: RealtimeConnectionState) => {
  sharedState = state;
  for (const subscriber of subscribers.values()) {
    try {
      subscriber.onStateChange?.(state);
    } catch {
      continue;
    }
  }
};

const notifyMessage = (payload: unknown) => {
  for (const subscriber of subscribers.values()) {
    try {
      subscriber.onMessage?.(payload);
    } catch {
      continue;
    }
  }
};

const clearAuthTimeout = () => {
  if (authTimeoutId !== null) {
    window.clearTimeout(authTimeoutId);
    authTimeoutId = null;
  }
};

const clearHeartbeat = () => {
  if (heartbeatIntervalId !== null) {
    window.clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
  }
};

const clearReconnect = () => {
  if (reconnectTimeoutId !== null) {
    window.clearTimeout(reconnectTimeoutId);
    reconnectTimeoutId = null;
  }
};

const cleanupSocket = () => {
  clearAuthTimeout();
  clearHeartbeat();
  if (socket) {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
  }
  socket = null;
  authenticated = false;
};

const scheduleReconnect = () => {
  if (!active || reconnectTimeoutId !== null || subscribers.size === 0) return;
  reconnectTimeoutId = window.setTimeout(() => {
    reconnectTimeoutId = null;
    connectSharedSocket();
  }, reconnectDelayMs);
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
};

const sendPing = () => {
  if (!socket || socket.readyState !== WebSocket.OPEN || !authenticated) {
    return;
  }
  if (lastHeartbeatAt && Date.now() - lastHeartbeatAt > STALE_CONNECTION_MS) {
    notifyState('fallback');
    socket.close();
    return;
  }
  socket.send(
    JSON.stringify({
      type: 'PING',
      at: new Date().toISOString(),
    })
  );
};

function connectSharedSocket() {
  if (!active || subscribers.size === 0) return;

  const token = authStorage.getToken();
  if (!token) {
    active = false;
    cleanupSocket();
    clearReconnect();
    notifyState('closed');
    return;
  }

  connectionToken = token;
  cleanupSocket();
  notifyState('connecting');

  socket = new WebSocket(`${API_CONFIG.WS_BASE_URL}/ws/incidents`);

  authTimeoutId = window.setTimeout(() => {
    notifyState('fallback');
    socket?.close();
  }, AUTH_TIMEOUT_MS);

  socket.onopen = () => {
    socket?.send(
      JSON.stringify({
        type: 'AUTH',
        token: connectionToken,
      })
    );
  };

  socket.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      const type = String(payload?.type || '').trim().toUpperCase();
      if (type === 'AUTH_OK') {
        authenticated = true;
        reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
        lastHeartbeatAt = Date.now();
        clearAuthTimeout();
        clearHeartbeat();
        heartbeatIntervalId = window.setInterval(sendPing, HEARTBEAT_INTERVAL_MS);
        notifyState('connected');
        return;
      }
      if (type === 'PONG') {
        lastHeartbeatAt = Date.now();
        if (authenticated) {
          notifyState('connected');
        }
        return;
      }
      notifyMessage(payload);
    } catch {
      return;
    }
  };

  socket.onerror = () => {
    if (authenticated) {
      notifyState('fallback');
    }
  };

  socket.onclose = (event) => {
    cleanupSocket();
    if (!active || subscribers.size === 0) {
      notifyState('closed');
      return;
    }
    if (event.code === 1008) {
      active = false;
      notifyState('closed');
      return;
    }
    notifyState('fallback');
    scheduleReconnect();
  };
}

const stopSharedSocket = () => {
  active = false;
  clearReconnect();
  const currentSocket = socket;
  cleanupSocket();
  if (currentSocket && currentSocket.readyState < WebSocket.CLOSING) {
    currentSocket.close();
  }
  notifyState('closed');
};

export const subscribeIncidentSocket = (
  options: RealtimeSubscriptionOptions = {}
): RealtimeSubscription | null => {
  if (!API_CONFIG.WS_BASE_URL) {
    options.onStateChange?.('fallback');
    return null;
  }

  const securityError = getRealtimeTransportSecurityError();
  if (securityError) {
    options.onStateChange?.('blocked');
    return null;
  }

  const token = authStorage.getToken();
  if (!token) {
    options.onStateChange?.('closed');
    return null;
  }

  const subscriberId = ++nextSubscriberId;
  subscribers.set(subscriberId, {
    onMessage: options.onMessage,
    onStateChange: options.onStateChange,
  });
  options.onStateChange?.(sharedState);

  if (connectionToken && token !== connectionToken) {
    stopSharedSocket();
  }

  if (!active) {
    active = true;
    reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
    clearReconnect();
    connectSharedSocket();
  } else if (!socket) {
    connectSharedSocket();
  }

  return {
    close: () => {
      subscribers.delete(subscriberId);
      if (subscribers.size === 0) {
        stopSharedSocket();
      } else {
        options.onStateChange?.('closed');
      }
    },
  };
};
