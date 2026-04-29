import { apiClient, ApiResponse } from './api';
import { API_ENDPOINTS } from '@/config/api';

export interface UserProfile {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  userType: 'citizen' | 'official' | 'head_supervisor';
  address?: string;
  pincode?: string;
  department?: string;
  twoFactorEnabled?: boolean;
}

export interface UserProfileUpdate {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  pincode?: string;
  department?: string;
}

export interface WorkerAccount {
  id: string;
  workerCode?: string;
  name: string;
  phone?: string;
  email?: string;
  officialRole: 'worker';
  workerSpecialization?: string;
}

export type ManagedOfficialRole = 'supervisor' | 'field_inspector';

export interface ManagedOfficialAccount {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  officialRole?: ManagedOfficialRole;
  department?: string;
  createdAt?: string;
}

export interface ManagedOfficialCreatePayload {
  name: string;
  email: string;
  phone?: string;
  password: string;
  officialRole: ManagedOfficialRole;
  address?: string;
  pincode?: string;
}

export const usersService = {
  async getProfile(): Promise<ApiResponse<UserProfile>> {
    return apiClient.get<UserProfile>(API_ENDPOINTS.USERS.PROFILE);
  },

  async updateProfile(payload: UserProfileUpdate): Promise<ApiResponse<UserProfile>> {
    return apiClient.put<UserProfile>(API_ENDPOINTS.USERS.UPDATE_PROFILE, payload);
  },

  async listWorkers(): Promise<ApiResponse<WorkerAccount[]>> {
    return apiClient.get<WorkerAccount[]>(API_ENDPOINTS.USERS.WORKERS);
  },

  async listManagedOfficials(): Promise<ApiResponse<ManagedOfficialAccount[]>> {
    return apiClient.get<ManagedOfficialAccount[]>(API_ENDPOINTS.USERS.MANAGED_OFFICIALS);
  },

  async createManagedOfficial(payload: ManagedOfficialCreatePayload): Promise<ApiResponse<ManagedOfficialAccount>> {
    return apiClient.post<ManagedOfficialAccount>(API_ENDPOINTS.USERS.MANAGED_OFFICIALS, payload);
  },
};

