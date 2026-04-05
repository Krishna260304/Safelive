import { apiClient, ApiResponse } from './api';
import { API_CONFIG, API_ENDPOINTS } from '@/config/api';
import { authStorage } from './auth-storage';

export type TicketChatTargetRole = 'department' | 'supervisor';

export interface TicketChatUserOption {
  id: string;
  name: string;
  role: string;
  department?: string | null;
  chatCryptoKey?: TicketChatSessionKeyBundle | null;
}

export interface TicketChatOptions {
  ticketId: string;
  ticketPublicId?: string | null;
  targetRoles: Array<{ value: TicketChatTargetRole; label: string }>;
  departments: TicketChatUserOption[];
  supervisors: TicketChatUserOption[];
  preferredTargetRole?: TicketChatTargetRole | null;
  preferredTargetUser?: TicketChatUserOption | null;
  localParticipant?: {
    id: string;
    name: string;
    role: string;
    label: string;
  } | null;
  existingSessions: TicketChatSession[];
  defaultTargetRole?: TicketChatTargetRole | null;
  currentUserRole: string;
  currentUserId: string;
  initiateEnabled: boolean;
  chatVisible: boolean;
  retentionHours: number;
}

export interface TicketChatInboxSummary {
  receivedChatsCount: number;
}

export interface TicketChatSessionParticipant {
  userId: string;
  name: string;
  role: string;
}

export interface TicketChatSessionKeyBundle {
  publicKeyJwk?: JsonWebKey;
  algorithm?: string;
  fingerprint?: string | null;
  updatedAt?: string;
}

export interface TicketChatSession {
  id: string;
  ticketId: string;
  incidentId?: string | null;
  targetRole: TicketChatTargetRole;
  officialUserId: string;
  officialUserName: string;
  officialDepartment?: string | null;
  localUserId: string;
  localUserName: string;
  participants: TicketChatSessionParticipant[];
  initiatedBy: string;
  startedByUserId: string;
  startedByName: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  endedAt?: string;
  endedByUserId?: string;
  endedByName?: string;
  expiresAt?: string;
  participantKeys?: Record<string, TicketChatSessionKeyBundle>;
}

export interface TicketChatAttachment {
  url: string;
  fileName?: string;
  contentType?: string;
  sizeBytes?: number;
  mediaType?: 'image' | 'video' | 'file';
  encrypted?: boolean;
  encryptionAlgorithm?: string;
  iv?: string;
  originalFileName?: string;
  originalMimeType?: string;
}

export interface TicketChatMessage {
  id: string;
  ticketId: string;
  sessionId: string;
  messageType: 'user' | 'assistant';
  message: string;
  attachments?: TicketChatAttachment[];
  senderId?: string;
  senderName?: string;
  senderRole?: string;
  aiGenerated?: boolean;
  createdAt: string;
  updatedAt?: string;
  encrypted?: boolean;
  messageCiphertext?: string;
  messageIv?: string;
  messageEncryptionAlgorithm?: string;
}

export interface TicketChatSessionOpenPayload {
  targetRole: TicketChatTargetRole;
  targetUserId?: string;
  localUserId?: string;
}

export interface TicketChatSendPayload {
  message?: string;
  files?: File[];
  encryptedMessage?: {
    ciphertext: string;
    iv: string;
    algorithm?: string;
  } | null;
  attachmentMeta?: Array<{
    encrypted?: boolean;
    iv?: string;
    encryptionAlgorithm?: string;
    mediaType?: 'image' | 'video' | 'file';
    originalFileName?: string;
    originalMimeType?: string;
  }>;
}

export interface TicketChatSessionKeyUpsertPayload {
  publicKeyJwk: JsonWebKey;
  algorithm?: string;
  fingerprint?: string;
}

export interface TicketChatSessionKeyUpsertResponse {
  session: TicketChatSession;
  peerKey?: TicketChatSessionKeyBundle | null;
}

export interface TicketChatIdentityKeyUpsertResponse extends TicketChatSessionKeyBundle {}
export interface TicketChatSessionDisconnectResponse {
  sessionId: string;
  purged: boolean;
  messagesDeleted: number;
  filesDeleted: number;
  sessionDeleted: boolean;
}

const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const isLoopbackHost = (hostname: string): boolean => LOOPBACK_HOSTS.has((hostname || '').trim().toLowerCase());

const isSecureBrowserContext = (): boolean => {
  if (typeof window === 'undefined') return true;
  return window.location.protocol === 'https:' || isLoopbackHost(window.location.hostname);
};

const isSecureApiBaseUrl = (): boolean => {
  const baseUrl = (API_CONFIG.BASE_URL || '').trim();
  if (!baseUrl || baseUrl.startsWith('/')) {
    return isSecureBrowserContext();
  }
  try {
    const parsed = new URL(baseUrl);
    return parsed.protocol === 'https:' || isLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
};

const getChatTransportSecurityError = (): string | null => {
  if (typeof window === 'undefined') return null;
  if (isSecureBrowserContext() && isSecureApiBaseUrl()) {
    return null;
  }
  return 'Secure HTTPS transport is required for chat outside localhost.';
};

const resolveMediaUrl = (value?: string): string | undefined => {
  const raw = (value || '').trim();
  if (!raw) return undefined;
  if (ABSOLUTE_URL_PATTERN.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) {
    return raw;
  }

  const normalizedPath = raw.startsWith('/') ? raw : `/${raw}`;
  if (API_CONFIG.BASE_URL.startsWith('http://') || API_CONFIG.BASE_URL.startsWith('https://')) {
    try {
      const apiUrl = new URL(API_CONFIG.BASE_URL);
      return `${apiUrl.protocol}//${apiUrl.host}${normalizedPath}`;
    } catch {
      return normalizedPath;
    }
  }

  if (typeof window !== 'undefined') {
    return `${window.location.origin}${normalizedPath}`;
  }

  return normalizedPath;
};

const normalizeMessageAttachments = (message: TicketChatMessage): TicketChatMessage => {
  const attachments = (message.attachments || []).map((attachment) => ({
    ...attachment,
    url: resolveMediaUrl(attachment.url) || attachment.url,
  }));
  return {
    ...message,
    attachments,
  };
};

const parseJsonSafely = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const extractErrorMessage = (payload: unknown, fallback: string): string => {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const detail = record.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
    const error = record.error;
    if (typeof error === 'string' && error.trim()) return error;
    const message = record.message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
};

const parseFilenameFromDisposition = (value: string | null): string | null => {
  if (!value) return null;
  const utfMatch = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch && utfMatch[1]) {
    try {
      return decodeURIComponent(utfMatch[1].trim());
    } catch {
      return utfMatch[1].trim();
    }
  }
  const plainMatch = value.match(/filename="?([^";]+)"?/i);
  return plainMatch && plainMatch[1] ? plainMatch[1].trim() : null;
};

export const ticketChatService = {
  async getInboxSummary(): Promise<ApiResponse<TicketChatInboxSummary>> {
    const securityError = getChatTransportSecurityError();
    if (securityError) return { success: false, error: securityError };
    return apiClient.get<TicketChatInboxSummary>(API_ENDPOINTS.TICKETS.CHAT_INBOX_SUMMARY);
  },

  async getOptions(ticketId: string): Promise<ApiResponse<TicketChatOptions>> {
    const securityError = getChatTransportSecurityError();
    if (securityError) return { success: false, error: securityError };
    return apiClient.get<TicketChatOptions>(API_ENDPOINTS.TICKETS.CHAT_OPTIONS(ticketId));
  },

  async openSession(ticketId: string, payload: TicketChatSessionOpenPayload): Promise<ApiResponse<TicketChatSession>> {
    const securityError = getChatTransportSecurityError();
    if (securityError) return { success: false, error: securityError };
    return apiClient.post<TicketChatSession>(API_ENDPOINTS.TICKETS.CHAT_SESSIONS(ticketId), payload);
  },

  async upsertSessionKey(
    ticketId: string,
    sessionId: string,
    payload: TicketChatSessionKeyUpsertPayload
  ): Promise<ApiResponse<TicketChatSessionKeyUpsertResponse>> {
    const securityError = getChatTransportSecurityError();
    if (securityError) return { success: false, error: securityError };
    return apiClient.post<TicketChatSessionKeyUpsertResponse>(API_ENDPOINTS.TICKETS.CHAT_SESSION_KEY(ticketId, sessionId), payload);
  },

  async upsertIdentityKey(payload: TicketChatSessionKeyUpsertPayload): Promise<ApiResponse<TicketChatIdentityKeyUpsertResponse>> {
    const securityError = getChatTransportSecurityError();
    if (securityError) return { success: false, error: securityError };
    return apiClient.post<TicketChatIdentityKeyUpsertResponse>(API_ENDPOINTS.TICKETS.CHAT_IDENTITY_KEY, payload);
  },

  async getMessages(
    ticketId: string,
    sessionId: string,
  ): Promise<ApiResponse<{ session: TicketChatSession; messages: TicketChatMessage[] }>> {
    const securityError = getChatTransportSecurityError();
    if (securityError) return { success: false, error: securityError };
    const response = await apiClient.get<{ session: TicketChatSession; messages: TicketChatMessage[] }>(
      API_ENDPOINTS.TICKETS.CHAT_MESSAGES(ticketId, sessionId)
    );
    if (!response.success || !response.data) {
      return response;
    }
    return {
      ...response,
      data: {
        session: response.data.session,
        messages: (response.data.messages || []).map((message) => normalizeMessageAttachments(message)),
      },
    };
  },

  async sendMessage(
    ticketId: string,
    sessionId: string,
    payload: TicketChatSendPayload,
  ): Promise<ApiResponse<TicketChatMessage[]>> {
    const securityError = getChatTransportSecurityError();
    if (securityError) return { success: false, error: securityError };
    const endpoint = API_ENDPOINTS.TICKETS.CHAT_MESSAGES(ticketId, sessionId);
    const formData = new FormData();
    formData.append('message', (payload.message || '').trim());
    if (payload.encryptedMessage?.ciphertext && payload.encryptedMessage.iv) {
      formData.append('messageEncrypted', 'true');
      formData.append('messageCiphertext', payload.encryptedMessage.ciphertext);
      formData.append('messageIv', payload.encryptedMessage.iv);
      formData.append('messageEncryptionAlgorithm', payload.encryptedMessage.algorithm || 'AES-GCM');
    }
    for (const file of payload.files || []) {
      formData.append('files', file);
    }
    if (payload.attachmentMeta && payload.attachmentMeta.length > 0) {
      formData.append('attachmentMeta', JSON.stringify(payload.attachmentMeta));
    }

    const token = authStorage.getToken();
    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: formData,
      });

      const body = await parseJsonSafely(response);
      if (!response.ok) {
        return {
          success: false,
          error: extractErrorMessage(body, 'Failed to send message'),
        };
      }

      if (body && typeof body === 'object' && (body as Record<string, unknown>).success === false) {
        return {
          success: false,
          error: extractErrorMessage(body, 'Failed to send message'),
        };
      }

      const payloadData =
        body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)
          ? ((body as Record<string, unknown>).data as TicketChatMessage[])
          : ([] as TicketChatMessage[]);

      return {
        success: true,
        data: (payloadData || []).map((message) => normalizeMessageAttachments(message)),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send message',
      };
    }
  },

  async endSession(ticketId: string, sessionId: string): Promise<ApiResponse<TicketChatSession>> {
    const securityError = getChatTransportSecurityError();
    if (securityError) return { success: false, error: securityError };
    return apiClient.post<TicketChatSession>(API_ENDPOINTS.TICKETS.CHAT_END(ticketId, sessionId));
  },

  async disconnectSession(ticketId: string, sessionId: string): Promise<ApiResponse<TicketChatSessionDisconnectResponse>> {
    const securityError = getChatTransportSecurityError();
    if (securityError) return { success: false, error: securityError };
    return apiClient.post<TicketChatSessionDisconnectResponse>(API_ENDPOINTS.TICKETS.CHAT_DISCONNECT(ticketId, sessionId));
  },

  async downloadTranscript(ticketId: string, sessionId: string): Promise<ApiResponse<{ filename: string }>> {
    const securityError = getChatTransportSecurityError();
    if (securityError) return { success: false, error: securityError };
    const token = authStorage.getToken();
    if (!token) {
      return { success: false, error: 'Authentication required' };
    }

    const endpoint = API_ENDPOINTS.TICKETS.CHAT_TRANSCRIPT(ticketId, sessionId);
    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}${endpoint}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const body = await parseJsonSafely(response);
        return {
          success: false,
          error: extractErrorMessage(body, 'Failed to download transcript'),
        };
      }

      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition');
      const filename = parseFilenameFromDisposition(disposition) || `ticket-chat-${ticketId}.pdf`;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);

      return { success: true, data: { filename } };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to download transcript',
      };
    }
  },
};
