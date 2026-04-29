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

export interface PincodeLookup {
  pincode: string;
  taluk?: string;
  district?: string;
  state?: string;
  datasetCount?: number;
  datasetSource?: string | null;
}

export const publicService = {
  async getSummary(): Promise<ApiResponse<PublicSummary>> {
    return apiClient.get<PublicSummary>('/public/summary', {
      headers: {}
    });
  },

  async verifyPincode(pincode: string): Promise<ApiResponse<PincodeLookup>> {
    return apiClient.get<PincodeLookup>(`/public/pincode/${encodeURIComponent(pincode)}`, {
      headers: {}
    });
  }
};
