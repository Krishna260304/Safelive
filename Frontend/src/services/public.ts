import { apiClient, ApiResponse } from './api';

export interface PublicSummary {
  total: number;
  resolved: number;
  open: number;
  pending?: number;
  inProgress: number;
  resolutionRate: number;
  recent: {
    id: string;
    title: string;
    category: string;
    status: string;
    location: string;
    createdAt: string;
  }[];
}

export const publicService = {
  async getSummary(): Promise<ApiResponse<PublicSummary>> {
    return apiClient.get<PublicSummary>('/public/summary', {
      headers: {}
    });
  }
};
