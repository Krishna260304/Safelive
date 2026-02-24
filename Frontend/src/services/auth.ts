import { apiClient, ApiResponse } from './api';
import { API_ENDPOINTS } from '@/config/api';

export type OfficialRole = 'department' | 'supervisor' | 'field_inspector' | 'worker';

export interface LoginData {
  email?: string;
  phone?: string;
  password: string;
  expectedUserType?: 'citizen' | 'official' | 'head_supervisor';
  expectedOfficialRole?: OfficialRole;
}

export interface RegisterData {
  name: string;
  email?: string;
  phone?: string;
  password: string;
  userType: 'citizen' | 'official' | 'head_supervisor';
  address?: string;
  pincode?: string;
  officialRole?: OfficialRole;
  workerSpecialization?: string;
}

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    name: string;
    fullName?: string;
    email?: string;
    phone?: string;
    userType: 'citizen' | 'official' | 'head_supervisor';
    officialRole?: OfficialRole;
    workerSpecialization?: string;
    address?: string;
    pincode?: string;
    department?: string;
    twoFactorEnabled?: boolean;
  };
}

export interface OtpChallenge {
  requiresOtp: true;
  challengeId: string;
  channels?: string[];
  maskedEmail?: string;
  maskedPhone?: string;
}

export type LoginResponse = AuthResponse | OtpChallenge;

export interface ForgotPasswordData {
  email?: string;
  phone?: string;
}



export const authService = {
  

  async login(data: LoginData): Promise<ApiResponse<LoginResponse>> {
    const response = await apiClient.post<LoginResponse>(API_ENDPOINTS.AUTH.LOGIN, data);
    
    if (response.success && (response.data as AuthResponse | undefined)?.token) {
      const auth = response.data as AuthResponse;
      localStorage.setItem('auth_token', auth.token);
      localStorage.setItem('user', JSON.stringify(auth.user));
    }
    
    return response;
  },

  async verifyOtp(challengeId: string, otp: string): Promise<ApiResponse<AuthResponse>> {
    const response = await apiClient.post<AuthResponse>(API_ENDPOINTS.AUTH.VERIFY_OTP, { challengeId, otp });

    if (response.success && response.data?.token) {
      localStorage.setItem('auth_token', response.data.token);
      localStorage.setItem('user', JSON.stringify(response.data.user));
    }

    return response;
  },

  

  async register(data: RegisterData): Promise<ApiResponse<AuthResponse>> {
    const response = await apiClient.post<AuthResponse>(API_ENDPOINTS.AUTH.REGISTER, data);
    
    if (response.success && response.data?.token) {
      localStorage.setItem('auth_token', response.data.token);
      localStorage.setItem('user', JSON.stringify(response.data.user));
    }
    
    return response;
  },

  async requestPasswordChangeOtp(currentPassword: string): Promise<ApiResponse<{
    challengeId: string;
    channels?: string[];
    maskedEmail?: string;
    maskedPhone?: string;
  }>> {
    return apiClient.post(API_ENDPOINTS.AUTH.CHANGE_PASSWORD_REQUEST_OTP, { currentPassword });
  },

  async confirmPasswordChange(challengeId: string, otp: string, newPassword: string): Promise<ApiResponse<{ changed: boolean }>> {
    return apiClient.post(API_ENDPOINTS.AUTH.CHANGE_PASSWORD_CONFIRM, { challengeId, otp, newPassword });
  },

  async requestEnable2faOtp(): Promise<ApiResponse<{
    challengeId: string;
    channels?: string[];
    maskedEmail?: string;
    maskedPhone?: string;
  }>> {
    return apiClient.post(API_ENDPOINTS.AUTH.TWO_FA_ENABLE_REQUEST_OTP);
  },

  async confirmEnable2fa(challengeId: string, otp: string): Promise<ApiResponse<AuthResponse['user']>> {
    const response = await apiClient.post<AuthResponse['user']>(API_ENDPOINTS.AUTH.TWO_FA_ENABLE_CONFIRM, { challengeId, otp });
    if (response.success && response.data) {
      localStorage.setItem('user', JSON.stringify(response.data));
    }
    return response;
  },

  async requestDisable2faOtp(): Promise<ApiResponse<{
    challengeId: string;
    channels?: string[];
    maskedEmail?: string;
    maskedPhone?: string;
  }>> {
    return apiClient.post(API_ENDPOINTS.AUTH.TWO_FA_DISABLE_REQUEST_OTP);
  },

  async confirmDisable2fa(challengeId: string, otp: string): Promise<ApiResponse<AuthResponse['user']>> {
    const response = await apiClient.post<AuthResponse['user']>(API_ENDPOINTS.AUTH.TWO_FA_DISABLE_CONFIRM, { challengeId, otp });
    if (response.success && response.data) {
      localStorage.setItem('user', JSON.stringify(response.data));
    }
    return response;
  },

  

  async logout(): Promise<void> {
    await apiClient.post(API_ENDPOINTS.AUTH.LOGOUT);
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
  },

  

  async forgotPassword(data: ForgotPasswordData): Promise<ApiResponse<{ message: string }>> {
    return apiClient.post(API_ENDPOINTS.AUTH.FORGOT_PASSWORD, data);
  },

  

  async resetPassword(token: string, password: string): Promise<ApiResponse<{ message: string }>> {
    return apiClient.post(API_ENDPOINTS.AUTH.RESET_PASSWORD, { token, password });
  },

  

  getCurrentUser() {
    const userStr = localStorage.getItem('user');
    return userStr ? JSON.parse(userStr) : null;
  },

  

  isAuthenticated(): boolean {
    return !!localStorage.getItem('auth_token');
  },
};

export const isOtpChallenge = (value: LoginResponse | null | undefined): value is OtpChallenge =>
  !!value && typeof value === 'object' && 'requiresOtp' in value;

export const isAuthResponse = (value: LoginResponse | null | undefined): value is AuthResponse =>
  !!value && typeof value === 'object' && 'token' in value;
