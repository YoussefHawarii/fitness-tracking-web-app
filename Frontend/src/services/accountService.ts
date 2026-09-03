import { apiClient } from './apiClient';

export type Units = 'KG' | 'LB';
export type Appearance = 'LIGHT' | 'DARK';

export interface AccountProfile {
  displayName: string;
  avatarUrl: string | null;
  unitsPreference: Units;
  languagePreference: string;
  appearancePreference: Appearance | null;
  hasPassword: boolean;
  googleLinked: boolean;
}

export async function getAccount(): Promise<AccountProfile> {
  const { data } = await apiClient.get('/profile/account');
  return data;
}

export async function updatePreferences(
  input: Partial<
    Pick<AccountProfile, 'unitsPreference' | 'languagePreference' | 'appearancePreference'>
  >,
): Promise<AccountProfile> {
  const { data } = await apiClient.patch('/profile/preferences', input);
  return data;
}

export async function updateDisplayName(displayName: string): Promise<AccountProfile> {
  const { data } = await apiClient.patch('/profile/account', { displayName });
  return data;
}

export interface AvatarUploadSignature {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
  uploadUrl: string;
}

export async function getAvatarUploadSignature(): Promise<AvatarUploadSignature> {
  const { data } = await apiClient.post('/profile/avatar/upload-signature');
  return data;
}

// Uploads directly to Cloudinary (not our own API) using the signed payload
// from getAvatarUploadSignature() — the image bytes never pass through our
// backend (specs/008-sidebar-profile-account/research.md §1).
export async function uploadToCloudinary(
  signature: AvatarUploadSignature,
  file: File,
): Promise<{ secure_url: string; public_id: string }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('api_key', signature.apiKey);
  formData.append('timestamp', String(signature.timestamp));
  formData.append('signature', signature.signature);
  formData.append('folder', signature.folder);

  const response = await fetch(signature.uploadUrl, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    throw new Error('Cloudinary upload failed');
  }
  return response.json();
}

export async function confirmAvatarUpload(url: string, publicId: string): Promise<{ avatarUrl: string }> {
  const { data } = await apiClient.patch('/profile/avatar', { url, publicId });
  return data;
}

export async function removeAvatar(): Promise<{ avatarUrl: null }> {
  const { data } = await apiClient.delete('/profile/avatar');
  return data;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiClient.patch('/profile/password', { currentPassword, newPassword });
}

export async function setPassword(newPassword: string): Promise<void> {
  await apiClient.post('/profile/password', { newPassword });
}

export async function linkGoogleAccount(idToken: string): Promise<{ googleLinked: boolean }> {
  const { data } = await apiClient.post('/profile/google/link', { idToken });
  return data;
}

export async function unlinkGoogleAccount(): Promise<{ googleLinked: boolean }> {
  const { data } = await apiClient.delete('/profile/google/link');
  return data;
}

export async function sendFeedback(subject: string, message: string): Promise<void> {
  await apiClient.post('/support/feedback', { subject, message });
}
