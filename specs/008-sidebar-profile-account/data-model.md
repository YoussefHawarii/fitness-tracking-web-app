# Data Model: Sidebar Profile Entry & Account/Settings Page

## Entity: User (existing — `users`, extended)

New columns added to the existing `User` model (`Backend/prisma/schema.prisma`); all existing columns (`id`, `username`, `email`, `emailVerified`, `passwordHash`, `googleSubjectId`, `timezone`, `createdAt`) are unchanged.

| Field | Type | Notes |
|---|---|---|
| `displayName` | `String?` | New. Distinct from `username`/`email` — the name shown in the sidebar profile block and greetings. Defaults to `username` when null (fallback, not stored). |
| `avatarUrl` | `String?` | New. The Cloudinary `secure_url` for the user's uploaded photo (research.md §1). Null = no photo uploaded, fall back to initials avatar. Used directly as an `<img src>` — publicly reachable, no auth-gated serving route needed. |
| `avatarPublicId` | `String?` | New. Cloudinary's `public_id` for the uploaded asset — required to delete/replace it via Cloudinary's API later; not shown to the user. |
| `unitsPreference` | `Units` (new enum: `KG` \| `LB`) | New. `@default(KG)`. Display-only (research.md §4). |
| `languagePreference` | `String` | New. `@default("en")`. A short language code; no enum since the exact supported-list can grow without a schema change. |
| `appearancePreference` | `Appearance?` (new enum: `LIGHT` \| `DARK`) | New. Null = "never explicitly chosen" — client falls back to OS preference (research.md §3). |

### Validation rules

- `displayName`: 1–50 characters when provided, trimmed; matches the general shape of `username`'s length constraint (`Length(3, 30)`) loosely widened since display names allow more characters (spaces, unicode) than the login `username`.
- `avatarUrl`/`avatarPublicId`: only set together, and only ever written by the backend after independently verifying the upload with Cloudinary (never trust a client-supplied URL/ID pair blindly — the update endpoint confirms the asset exists under this account's signed folder before persisting); format/size limits (FR-014) are enforced by the signed upload payload's constraints, not re-validated from stored fields.
- `unitsPreference`: one of the `Units` enum values.
- `languagePreference`: non-empty string; validated against a small server-known list of supported codes (e.g. `["en"]` initially) — an unsupported code is still stored (per spec FR-020 — the choice is saved even if not yet translated) but the frontend shows the "not yet fully supported" notice for anything outside that list.
- `appearancePreference`: one of the `Appearance` enum values, or null.

## Entity: Feedback Submission (transient — not persisted)

Represents one Support-section feedback send (research.md §7). Not stored as a database row — it is validated, emailed via `MailService`, and discarded; no history/inbox view is in scope.

| Field | Type | Notes |
|---|---|---|
| `subject` | `String` | 1–120 characters. |
| `message` | `String` | 1–2000 characters. |

## Relationships

```text
User (1) ── (0..*) FoodLogEntry / ExerciseLogEntry / WeighIn / RefreshToken / OtpCode   [unchanged, existing]
```

No changes to any other existing entity or relationship (`UserBaseline`, `LocalFoodItem`, `FoodLogEntry`, `ExerciseLogEntry`, `WeighIn`, `RefreshToken`, `OtpCode` are all untouched by this feature).

## Frontend view-model additions

- **`AccountProfile`** (`accountService.ts`): `{ displayName, avatarUrl, unitsPreference, languagePreference, appearancePreference, hasPassword, googleLinked }` — the shape returned by a new `GET /profile/account` endpoint, composed server-side from `User` + whether `googleSubjectId`/`passwordHash` are set (never returns the hash, Google subject id, or Cloudinary public ID itself). `avatarUrl` is `null` when no photo is set — the frontend `Avatar` component falls back to initials whenever it's falsy, so no separate `hasAvatar` boolean is needed now that the URL itself is public and directly usable.
- **Theme state** (`ThemeContext`): `'light' | 'dark'` resolved value (never null at the point of use — the OS-preference fallback resolves it before render), plus the raw stored preference (`'LIGHT' | 'DARK' | null`) for the Appearance toggle's own display state.
