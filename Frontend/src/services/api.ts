import { API_CONFIG } from '@/config/api';
import { authStorage } from './auth-storage';



export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getString = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
};

const getErrorMessageFromDetail = (detail: unknown): string | undefined => {
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const firstWithMsg = detail.find(
      (item) => isRecord(item) && typeof item.msg === 'string' && item.msg.trim()
    );
    if (isRecord(firstWithMsg) && typeof firstWithMsg.msg === 'string') {
      return firstWithMsg.msg;
    }
  }
  if (isRecord(detail)) {
    return getString(detail, 'message') || getString(detail, 'msg') || getString(detail, 'error');
  }
  return undefined;
};

const extractErrorMessage = (value: unknown): string | undefined => {
  if (!isRecord(value)) return undefined;
  const detailMessage = getErrorMessageFromDetail(value.detail);
  return getString(value, 'message') || detailMessage || getString(value, 'detail') || getString(value, 'error');
};

const getTextErrorFallback = (text: string, status: number, statusText: string): string => {
  const trimmed = text.trim();
  if (!trimmed) return statusText || `Request failed (${status})`;
  if (trimmed.startsWith('<')) return statusText || `Request failed (${status})`;
  return trimmed.length > 240 ? `${trimmed.slice(0, 240)}...` : trimmed;
};


class ApiClient {
  private baseURL: string;
  private timeout: number;

  constructor() {
    this.baseURL = API_CONFIG.BASE_URL;
    this.timeout = API_CONFIG.TIMEOUT;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const token = authStorage.getToken();
      
      const response = await fetch(`${this.baseURL}${endpoint}`, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
          ...options.headers,
        },
      });

      clearTimeout(timeoutId);

      let data: unknown = null;
      let responseText = '';
      try {
        responseText = await response.text();
        data = responseText ? JSON.parse(responseText) : null;
      } catch {
        data = null;
      }

      if (!response.ok) {
        const extractedError =
          extractErrorMessage(data) ||
          getTextErrorFallback(responseText, response.status, response.statusText) ||
          'Request failed';

        if (response.status === 401 && token) {
          authStorage.clear();

          if (typeof window !== 'undefined') {
            const loginPath = window.location.pathname.startsWith('/official') ? '/official/login' : '/login';
            if (window.location.pathname !== loginPath) {
              window.location.href = loginPath;
            }
          }
        }

        return {
          success: false,
          error: extractedError,
        };
      }

      if (isRecord(data) && data.success === false) {
        return {
          success: false,
          error: extractErrorMessage(data) || 'Request failed',
        };
      }

      const payload = isRecord(data) && 'data' in data ? (data as Record<string, unknown>).data : data;
      return {
        success: true,
        data: payload as T,
        message: isRecord(data) ? getString(data, 'message') : undefined,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async get<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  async post<T>(endpoint: string, data?: unknown, options?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async put<T>(endpoint: string, data?: unknown, options?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async patch<T>(endpoint: string, data?: unknown, options?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async delete<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }

  async uploadFile<T>(endpoint: string, file: File, additionalData?: Record<string, unknown>): Promise<ApiResponse<T>> {
    const formData = new FormData();
    formData.append('file', file);
    
    if (additionalData) {
      Object.entries(additionalData).forEach(([key, value]) => {
        formData.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
      });
    }

    const token = authStorage.getToken();

    try {
      const response = await fetch(`${this.baseURL}${endpoint}`, {
        method: 'POST',
        headers: {
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: formData,
      });

      let data: unknown = null;
      let responseText = '';
      try {
        responseText = await response.text();
        data = responseText ? JSON.parse(responseText) : null;
      } catch {
        data = null;
      }

      if (!response.ok) {
        return {
          success: false,
          error:
            extractErrorMessage(data) ||
            getTextErrorFallback(responseText, response.status, response.statusText) ||
            'Upload failed',
        };
      }

      if (isRecord(data) && data.success === false) {
        return {
          success: false,
          error: extractErrorMessage(data) || 'Upload failed',
        };
      }

      const payload = isRecord(data) && 'data' in data ? (data as Record<string, unknown>).data : data;
      return {
        success: true,
        data: payload as T,
        message: isRecord(data) ? getString(data, 'message') : undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Upload failed',
      };
    }
  }
}

export const apiClient = new ApiClient();
