import { apiClient, ApiResponse } from './api';
import { API_CONFIG, API_ENDPOINTS } from '@/config/api';

export interface Incident {
  id: string;
  title: string;
  description?: string;
  category: string;
  status: 'open' | 'pending' | 'in_progress' | 'resolved' | 'verified' | 'rejected';
  priority?: 'low' | 'medium' | 'high' | 'critical';
  location: string;
  latitude?: number;
  longitude?: number;
  images?: string[];
  imageUrls?: string[];
  imageUrl?: string;
  reportedBy?: string;
  reporterId?: string;
  reporterEmail?: string;
  reporterPhone?: string;
  commonIncident?: boolean;
  duplicateReportCount?: number;
  duplicateMatch?: boolean;
  assignedTo?: string;
  incidentId?: string;
  ticketId?: string;
  severity?: string;
  scope?: string;
  source?: string;
  deviceId?: string;
  officialActionTaken?: boolean;
  reporterDeleteLocked?: boolean;
  createdAt: string;
  updatedAt?: string;
  hasMessages?: boolean;
}

export interface IncidentStats {
  total: number;
  open: number;
  inProgress: number;
  resolved: number;
  pending: number;
}

export interface IncidentLogEntry {
  id: string;
  ticketId?: string;
  incidentId?: string;
  action: string;
  actorUserId?: string;
  actorName?: string;
  actorOfficialRole?: string;
  createdAt: string;
  summary?: string;
  details?: Record<string, unknown>;
}

export interface CreateIncidentData {
  title: string;
  description?: string;
  category: string;
  location: string;
  latitude: number;
  longitude: number;
  images?: File[];
}

export interface UpdateIncidentData {
  title?: string;
  description?: string;
  category?: string;
  status?: string;
  location?: string;
}

const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//;

const resolveImageUrl = (value?: string): string | undefined => {
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

export const normalizeIncidentMedia = (incident: Incident): Incident => {
  const normalizedImageUrls = (incident.imageUrls || [])
    .map((url) => resolveImageUrl(url))
    .filter((url): url is string => Boolean(url));
  const primaryImage = resolveImageUrl(incident.imageUrl) || normalizedImageUrls[0];

  return {
    ...incident,
    imageUrl: primaryImage,
    imageUrls: normalizedImageUrls.length ? normalizedImageUrls : undefined,
  };
};

const normalizeIncidentListMedia = (incidents: Incident[]): Incident[] =>
  incidents.map((incident) => normalizeIncidentMedia(incident));

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const parts = result.split(',');
      const base64 = parts.length > 1 ? parts[1] : '';
      if (!base64) {
        reject(new Error('Invalid image data'));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
};



export const incidentService = {
  

  async getIncidents(): Promise<ApiResponse<Incident[]>> {
    const response = await apiClient.get<Incident[]>(API_ENDPOINTS.INCIDENTS.LIST);
    if (!response.success || !response.data) {
      return response;
    }
    return { ...response, data: normalizeIncidentListMedia(response.data) };
  },

  

  async getIncidentById(id: string): Promise<ApiResponse<Incident>> {
    const response = await apiClient.get<Incident>(API_ENDPOINTS.INCIDENTS.GET_BY_ID(id));
    if (!response.success || !response.data) {
      return response;
    }
    return { ...response, data: normalizeIncidentMedia(response.data) };
  },

  async getLogbook(id: string): Promise<ApiResponse<IncidentLogEntry[]>> {
    return apiClient.get<IncidentLogEntry[]>(API_ENDPOINTS.INCIDENTS.LOGBOOK(id));
  },

  

  async createIncident(data: CreateIncidentData): Promise<ApiResponse<Incident>> {
    if (data.images && data.images.length > 0) {
      let base64Images: string[] = [];
      try {
        base64Images = await Promise.all(data.images.map(fileToBase64));
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to process incident images',
        };
      }
      const { images, ...incidentData } = data;
      const response = await apiClient.post<Incident>(API_ENDPOINTS.INCIDENTS.CREATE, {
        ...incidentData,
        images: base64Images
      });
      if (!response.success || !response.data) {
        return response;
      }
      return { ...response, data: normalizeIncidentMedia(response.data) };
    }
    const response = await apiClient.post<Incident>(API_ENDPOINTS.INCIDENTS.CREATE, data);
    if (!response.success || !response.data) {
      return response;
    }
    return { ...response, data: normalizeIncidentMedia(response.data) };
  },

  

  async updateIncident(id: string, data: UpdateIncidentData): Promise<ApiResponse<Incident>> {
    const response = await apiClient.put<Incident>(API_ENDPOINTS.INCIDENTS.UPDATE(id), data);
    if (!response.success || !response.data) {
      return response;
    }
    return { ...response, data: normalizeIncidentMedia(response.data) };
  },

  

  async deleteIncident(id: string): Promise<ApiResponse<void>> {
    return apiClient.delete(API_ENDPOINTS.INCIDENTS.DELETE(id));
  },

  

  async getStats(): Promise<ApiResponse<IncidentStats>> {
    return apiClient.get<IncidentStats>(API_ENDPOINTS.INCIDENTS.STATS);
  },
};
