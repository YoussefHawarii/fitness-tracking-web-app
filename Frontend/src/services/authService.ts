import { apiClient } from './apiClient';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface SignupInput {
  username: string;
  email: string;
  password: string;
  timezone: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export async function signup(input: SignupInput) {
  const { data } = await apiClient.post('/auth/signup', input);
  return data as { email: string; otpRequested: boolean };
}

export async function verifyOtp(email: string, code: string) {
  const { data } = await apiClient.post('/auth/verify-otp', { email, code });
  return data as AuthTokens & { userId: string; emailVerified: boolean };
}

export async function resendOtp(email: string) {
  const { data } = await apiClient.post('/auth/resend-otp', { email });
  return data as { otpRequested: boolean };
}

export async function login(input: LoginInput) {
  const { data } = await apiClient.post('/auth/login', input);
  return data as AuthTokens & { userId: string; hasBaseline: boolean };
}

export async function googleLogin(idToken: string, timezone: string) {
  const { data } = await apiClient.post('/auth/google', { idToken, timezone });
  return data as AuthTokens & { userId: string; hasBaseline: boolean };
}

export async function refreshTokens(refreshToken: string) {
  const { data } = await apiClient.post('/auth/refresh', { refreshToken });
  return data as AuthTokens;
}

export async function logout() {
  const { data } = await apiClient.post('/auth/logout');
  return data as { loggedOut: boolean };
}
