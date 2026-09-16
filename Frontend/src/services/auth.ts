import { apiClient, ApiResponse } from './api';
import { API_ENDPOINTS } from '@/config/api';
import { authStorage } from './auth-storage';

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
      authStorage.setToken(auth.token);
      authStorage.setUser(auth.user);
    }

    return response;
  },

  async verifyOtp(challengeId: string, otp: string): Promise<ApiResponse<AuthResponse>> {
    const response = await apiClient.post<AuthResponse>(API_ENDPOINTS.AUTH.VERIFY_OTP, { challengeId, otp });

    if (response.success && response.data?.token) {
      authStorage.setToken(response.data.token);
      authStorage.setUser(response.data.user);
    }

    return response;
  },

  async register(data: any): Promise<ApiResponse<AuthResponse>> {
    const payload = {
      name: data.name || data.fullName,
      password: data.password,
      userType: data.userType || 'citizen',
      email: data.email,
      phone: data.phone,
      address: data.address,
      pincode: data.pincode,
      officialRole: data.officialRole,
      workerSpecialization: data.workerSpecialization,
    };

    const response = await apiClient.post<AuthResponse>(API_ENDPOINTS.AUTH.REGISTER, payload);

    if (response.success && response.data?.token) {
      authStorage.setToken(response.data.token);
      authStorage.setUser(response.data.user);
    }

    return response;
  },

  async requestPasswordChangeOtp(currentPassword: string): Promise<ApiResponse<any>> {
    return apiClient.post(API_ENDPOINTS.AUTH.CHANGE_PASSWORD_REQUEST_OTP, { currentPassword });
  },

  async confirmPasswordChange(challengeId: string, otp: string, newPassword: string): Promise<ApiResponse<any>> {
    return apiClient.post(API_ENDPOINTS.AUTH.CHANGE_PASSWORD_CONFIRM, { challengeId, otp, newPassword });
  },

  async requestEnable2faOtp(): Promise<ApiResponse<any>> {
    return apiClient.post(API_ENDPOINTS.AUTH.TWO_FA_ENABLE_REQUEST_OTP);
  },

  async confirmEnable2fa(challengeId: string, otp: string): Promise<ApiResponse<any>> {
    const response = await apiClient.post(API_ENDPOINTS.AUTH.TWO_FA_ENABLE_CONFIRM, { challengeId, otp });
    if (response.success && response.data) {
      authStorage.setUser(response.data);
    }
    return response;
  },

  async requestDisable2faOtp(): Promise<ApiResponse<any>> {
    return apiClient.post(API_ENDPOINTS.AUTH.TWO_FA_DISABLE_REQUEST_OTP);
  },

  async confirmDisable2fa(challengeId: string, otp: string): Promise<ApiResponse<any>> {
    const response = await apiClient.post(API_ENDPOINTS.AUTH.TWO_FA_DISABLE_CONFIRM, { challengeId, otp });
    if (response.success && response.data) {
      authStorage.setUser(response.data);
    }
    return response;
  },

  async logout(): Promise<void> {
    await apiClient.post(API_ENDPOINTS.AUTH.LOGOUT);
    authStorage.clear();
  },

  async forgotPassword(data: ForgotPasswordData): Promise<ApiResponse<{ message: string }>> {
    return apiClient.post(API_ENDPOINTS.AUTH.FORGOT_PASSWORD, data);
  },

  async resetPassword(token: string, password: string): Promise<ApiResponse<{ message: string }>> {
    return apiClient.post(API_ENDPOINTS.AUTH.RESET_PASSWORD, { token, password });
  },

  getCurrentUser() {
    const userStr = authStorage.getUser();
    if (!userStr) return null;
    try {
      return JSON.parse(userStr);
    } catch {
      authStorage.clearUser();
      return null;
    }
  },

  isAuthenticated(): boolean {
    return !!authStorage.getToken();
  },
};

export const isOtpChallenge = (value: LoginResponse | null | undefined): value is OtpChallenge =>
  !!value && typeof value === 'object' && 'requiresOtp' in value;

export const isAuthResponse = (value: LoginResponse | null | undefined): value is AuthResponse =>
  !!value && typeof value === 'object' && 'token' in value;
