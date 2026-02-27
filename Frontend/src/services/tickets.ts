import { apiClient, ApiResponse } from './api';
import { API_CONFIG, API_ENDPOINTS } from '@/config/api';

export interface Ticket {
  id: string;
  ticketId?: string;
  incidentId?: string;
  title: string;
  description?: string;
  category: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'pending' | 'in_progress' | 'resolved' | 'verified';
  location: string;
  latitude?: number;
  longitude?: number;
  imageUrl?: string;
  imageUrls?: string[];
  reportedBy: string;
  assignedTo?: string;
  assigneeName?: string;
  assigneePhone?: string;
  assigneePhotoUrl?: string;
  assigneeEmail?: string;
  assigneeUserId?: string;
  workerId?: string;
  workerCode?: string;
  workerIds?: string[];
  workerCodes?: string[];
  assignees?: Array<{
    workerId: string;
    workerCode?: string;
    name: string;
    phone?: string;
    email?: string;
    workerSpecialization?: string;
    assignedAt?: string;
  }>;
  workerSpecialization?: string;
  workerSpecializations?: string[];
  fieldInspectorId?: string;
  fieldInspectorName?: string;
  progressPercent?: number;
  progressSummary?: string;
  progressSource?: string;
  progressConfidence?: number;
  progressUpdatedAt?: string;
  lastInspectorUpdateAt?: string;
  lastWorkerUpdateAt?: string;
  reopenedBy?: {
    id?: string;
    name?: string;
    timestamp?: string;
  };
  reopenedSupervisorId?: string;
  reopenedSupervisorName?: string;
  reopenedSupervisorEmail?: string;
  reopenedSupervisorAssignedAt?: string;
  reopenedFromResolverId?: string;
  reopenedFromResolverName?: string;
  reopenedFromResolverRole?: string;
  resolvedById?: string;
  resolvedByName?: string;
  resolvedByRole?: string;
  resolvedAt?: string;
  reopenWarning?: {
    message: string;
    issuedAt: string;
    supervisorName?: string;
    departmentName?: string;
  };
  createdAt: string;
  updatedAt?: string;
}

export interface TicketStats {
  totalTickets: number;
  openTickets: number;
  pendingTickets?: number;
  inProgress: number;
  resolvedToday: number;
  avgResponseTime: string;
  resolutionRate: number;
}

export interface UpdateStatusData {
  status: string;
  notes?: string;
}

export interface AssignTicketData {
  workerId?: string;
  workerIds?: string[];
  assignedTo?: string;
  assigneeName?: string;
  assigneePhone?: string;
  assigneePhoto?: string;
  notes?: string;
}

export interface AssignSupervisorData {
  supervisorId: string;
  notes?: string;
}

export interface ProgressUpdateData {
  updateText: string;
  editLastUpdate?: boolean;
}

export interface TicketLogEntry {
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

const normalizeTicketMedia = (ticket: Ticket): Ticket => {
  const normalizedImageUrls = (ticket.imageUrls || [])
    .map((url) => resolveImageUrl(url))
    .filter((url): url is string => Boolean(url));
  const primaryImage = resolveImageUrl(ticket.imageUrl) || normalizedImageUrls[0];
  return {
    ...ticket,
    imageUrl: primaryImage,
    imageUrls: normalizedImageUrls.length ? normalizedImageUrls : undefined,
  };
};

const normalizeTicketListMedia = (tickets: Ticket[]): Ticket[] =>
  tickets.map((ticket) => normalizeTicketMedia(ticket));



export const ticketService = {
  

  async getTickets(filters?: {
    status?: string;
    priority?: string;
    category?: string;
  }): Promise<ApiResponse<Ticket[]>> {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.priority) params.set('priority', filters.priority);
    if (filters?.category) params.set('category', filters.category);
    const query = params.toString();
    const queryParams = query ? `?${query}` : '';
    const response = await apiClient.get<Ticket[]>(`${API_ENDPOINTS.TICKETS.LIST}${queryParams}`);
    if (!response.success || !response.data) {
      return response;
    }
    return { ...response, data: normalizeTicketListMedia(response.data) };
  },

  

  async getTicketById(id: string): Promise<ApiResponse<Ticket>> {
    const response = await apiClient.get<Ticket>(API_ENDPOINTS.TICKETS.GET_BY_ID(id));
    if (!response.success || !response.data) {
      return response;
    }
    return { ...response, data: normalizeTicketMedia(response.data) };
  },

  

  async updateStatus(id: string, data: UpdateStatusData): Promise<ApiResponse<Ticket>> {
    return apiClient.patch<Ticket>(API_ENDPOINTS.TICKETS.UPDATE_STATUS(id), data);
  },

  

  async assignTicket(id: string, data: AssignTicketData): Promise<ApiResponse<Ticket>> {
    return apiClient.post<Ticket>(API_ENDPOINTS.TICKETS.ASSIGN(id), data);
  },

  async assignSupervisor(id: string, data: AssignSupervisorData): Promise<ApiResponse<Ticket>> {
    return apiClient.post<Ticket>(API_ENDPOINTS.TICKETS.ASSIGN_SUPERVISOR(id), data);
  },

  async updateProgress(id: string, data: ProgressUpdateData): Promise<ApiResponse<Ticket>> {
    return apiClient.post<Ticket>(API_ENDPOINTS.TICKETS.PROGRESS_UPDATE(id), data);
  },

  async getLogbook(id: string): Promise<ApiResponse<TicketLogEntry[]>> {
    return apiClient.get<TicketLogEntry[]>(API_ENDPOINTS.TICKETS.LOGBOOK(id));
  },

  async deleteLogbookEntry(ticketId: string, entryId: string): Promise<ApiResponse<{ message?: string }>> {
    return apiClient.delete<{ message?: string }>(API_ENDPOINTS.TICKETS.DELETE_LOGBOOK_ENTRY(ticketId, entryId));
  },

  

  async getStats(): Promise<ApiResponse<TicketStats>> {
    return apiClient.get<TicketStats>(API_ENDPOINTS.TICKETS.STATS);
  },
};
