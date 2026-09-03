# Contract: Account/Settings API

New routes, all requiring the existing `JwtAuthGuard` (Bearer access token) and scoped to the authenticated user only (FR-024). Mounted on the existing `users` module (`/profile/...`) except feedback, which is new and small enough to live in `mail` (`/support/...`).

## `GET /profile/account`

Returns the settings-page view of the current user (never the password hash or raw Google subject id).

**Response `200 OK`**:
```json
{
  "displayName": "Jamie",
  "avatarUrl": "https://res.cloudinary.com/.../avatars/u_123/abc.jpg",
  "unitsPreference": "KG",
  "languagePreference": "en",
  "appearancePreference": "DARK",
  "hasPassword": true,
  "googleLinked": false
}
```

## `PATCH /profile/account`

Updates display name only (`UpdateAccountDto`: `{ displayName: string }`, 1–50 chars, trimmed). Returns the updated `GET /profile/account` shape. `400` on invalid length.

## `POST /profile/avatar/upload-signature`

Step 1 of the avatar upload flow (research.md §1). Returns a short-lived signed payload the frontend uses to upload directly to Cloudinary, scoped to a per-user folder so uploads can't be aimed elsewhere in the Cloudinary account.

**Response `200 OK`**:
```json
{
  "cloudName": "your-cloud-name",
  "apiKey": "123456789012345",
  "timestamp": 1735689600,
  "signature": "a1b2c3...",
  "folder": "avatars/u_<userId>",
  "uploadUrl": "https://api.cloudinary.com/v1_1/your-cloud-name/image/upload"
}
```
The frontend `POST`s the selected file plus these exact fields (`api_key`, `timestamp`, `signature`, `folder`) as `multipart/form-data` directly to `uploadUrl`. On success, Cloudinary returns `{ secure_url, public_id, bytes, format, ... }` to the browser.

## `PATCH /profile/avatar`

Step 2: persists a completed Cloudinary upload. Body (`UploadAvatarDto`): `{ url: string, publicId: string }` — both taken verbatim from the Cloudinary response in step 1. The backend verifies the asset exists under this account's own `avatars/u_<userId>` folder (via a Cloudinary lookup by `publicId`) before trusting the URL, then replaces `avatarUrl`/`avatarPublicId` (deleting the previous asset from Cloudinary if one existed) and returns `{ avatarUrl: string }`. `400` if the asset can't be verified or doesn't belong to this user's folder.

## `DELETE /profile/avatar`

Removes the current avatar: deletes the Cloudinary asset (via stored `avatarPublicId`) and clears both fields. Returns `{ avatarUrl: null }`. No-op success if there was no avatar to begin with (idempotent).

## `PATCH /profile/password`

Changes an existing password. Body (`ChangePasswordDto`): `{ currentPassword: string, newPassword: string }` (`newPassword` ≥ 8 chars, matching signup). `401`/`400` with a clear message if `currentPassword` doesn't match, or if the account has no password yet (use `POST /profile/password` instead — FR-015). `204` on success.

## `POST /profile/password`

Sets an initial password for a Google-only account with none yet. Body (`SetPasswordDto`): `{ newPassword: string }` (≥ 8 chars). `409 Conflict` if the account already has a password (use `PATCH` instead). `204` on success.

## `POST /profile/google/link`

Links the signed-in user's account to a Google identity. Body: `{ idToken: string }` (from the Google Identity Services client flow, same shape already used by `POST /auth/google`). `409 Conflict` if that Google subject is already linked to a different user. `200 OK` with `{ googleLinked: true }` on success.

## `DELETE /profile/google/link`

Unlinks Google from the current user. `409 Conflict` (with an explanatory message) if the account has no password set — unlinking would leave no way to sign in (FR-016, Story 3 Scenario 8). `200 OK` with `{ googleLinked: false }` on success.

## `PATCH /profile/preferences`

Updates units/language/appearance in one call (`UpdatePreferencesDto`, all optional): `{ unitsPreference?: "KG" | "LB", languagePreference?: string, appearancePreference?: "LIGHT" | "DARK" }`. Returns the updated `GET /profile/account` shape.

## `POST /support/feedback`

Sends a feedback message via email (research.md §7). Body: `{ subject: string, message: string }` (subject 1–120 chars, message 1–2000 chars). `202 Accepted` on a best-effort send attempt (mirrors `sendWelcomeEmail`'s pattern — a transient mail-provider hiccup shouldn't read as the user's fault); `400` on validation failure.

---

## Frontend service additions (`Frontend/src/services/accountService.ts`)

```ts
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

export interface AvatarUploadSignature {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
  uploadUrl: string;
}

export async function getAccount(): Promise<AccountProfile>;
export async function updateDisplayName(displayName: string): Promise<AccountProfile>;
export async function getAvatarUploadSignature(): Promise<AvatarUploadSignature>;
// Caller uploads the file directly to Cloudinary using the signature above,
// then confirms the result here:
export async function confirmAvatarUpload(url: string, publicId: string): Promise<{ avatarUrl: string }>;
export async function removeAvatar(): Promise<{ avatarUrl: null }>;
export async function changePassword(currentPassword: string, newPassword: string): Promise<void>;
export async function setPassword(newPassword: string): Promise<void>;
export async function linkGoogleAccount(idToken: string): Promise<{ googleLinked: boolean }>;
export async function unlinkGoogleAccount(): Promise<{ googleLinked: boolean }>;
export async function updatePreferences(input: Partial<Pick<AccountProfile, 'unitsPreference' | 'languagePreference' | 'appearancePreference'>>): Promise<AccountProfile>;
export async function sendFeedback(subject: string, message: string): Promise<void>;
```

No existing contracts (`/onboarding`, `/food/*`, `/exercise-logs`, `/balance`, `/auth/*`) change. **One existing contract is renamed, not left as-is**: the "Goals"/baseline API previously at `GET`/`PATCH /profile` moves to `GET`/`PATCH /goals` (same request/response shape, same `UsersController`, just a renamed route — research.md §9), so it no longer shares any name with this feature's own `/profile/account`, `/profile/avatar`, `/profile/password`, `/profile/google/link`, `/profile/preferences` routes. Any existing frontend/backend caller of the old `/profile` baseline route must be updated to `/goals` as part of this feature (`Frontend/src/services/userService.ts`, `Frontend/src/pages/Goals.tsx`).
