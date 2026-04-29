import { apiClient, ApiResponse } from './api';
import { API_ENDPOINTS } from '@/config/api';

export interface AnalyticsDashboard {
  incidents: {
    total: number;
    open: number;
    pending?: number;
    inProgress: number;
    resolved: number;
  };
  tickets: {
    total: number;
    open: number;
    pending?: number;
    inProgress: number;
    resolved: number;
  };
  cityCleanlinessScore: number;
  safetyIndex: number;
  byCategory: { category: string; count: number }[];
  workerProductivity: {
    worker: string;
    total: number;
    resolved: number;
    open: number;
    pending?: number;
    inProgress: number;
    resolutionRate: number;
  }[];
}

export interface HeatmapPoint {
  lat: number;
  lng: number;
  weight: number;
  category?: string;
  status?: string;
}

export interface TrendPoint {
  date: string;
  created: number;
  resolved: number;
}

export const analyticsService = {
  async getDashboard(): Promise<ApiResponse<AnalyticsDashboard>> {
    return apiClient.get<AnalyticsDashboard>(API_ENDPOINTS.ANALYTICS.DASHBOARD);
  },

  async getHeatmap(): Promise<ApiResponse<HeatmapPoint[]>> {
    return apiClient.get<HeatmapPoint[]>(API_ENDPOINTS.ANALYTICS.HEATMAP);
  },

  async getTrends(days = 14): Promise<ApiResponse<TrendPoint[]>> {
    const clampedDays = Math.max(7, Math.min(days, 60));
    return apiClient.get<TrendPoint[]>(`${API_ENDPOINTS.ANALYTICS.TRENDS}?days=${clampedDays}`);
  },
};
