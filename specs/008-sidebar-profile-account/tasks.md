---

description: "Task list template for feature implementation"
---

# Tasks: Sidebar Profile Entry & Account/Settings Page

**Input**: Design documents from `/specs/008-sidebar-profile-account/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/account-settings-api.md](contracts/account-settings-api.md), [quickstart.md](quickstart.md)

**Tests**: Backend tests are included — `CLAUDE.md` requires e2e tests to be run locally for any backend behavior change, and this feature adds many new backend routes. Frontend has no automated test runner configured in this repo, so frontend verification tasks are manual (against `quickstart.md`) rather than automated.

**Organization**: Tasks are grouped by user story (from [spec.md](spec.md)) to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files from other tasks in its batch)
- **[Story]**: Which user story this task belongs to (US1–US5)
- Every task includes an exact file path

## Path Conventions

Existing web app layout: `Backend/src/...`, `Backend/test/...`, `Frontend/src/...` (no new top-level directories — see plan.md's Project Structure).

---

## Phase 1: Setup

- [X] T001 Verify local dev environment: `Backend/.env` configured per `Backend/.env.example`, `npm run start:dev` (from `Backend/`) starts cleanly, `npm run dev` (from `Frontend/`) starts and calls the running backend. No code changes — unblocks manual testing for every story below.
- [X] T002 [P] Add new env var placeholders: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (required, US3), `SUPPORT_EMAIL` (optional, falls back to `SMTP_FROM`, US5) to `Backend/.env.example`; add `VITE_HELP_CENTER_URL`, `VITE_TERMS_URL`, `VITE_PRIVACY_URL` (optional, with in-repo fallbacks, US5) to a `Frontend/.env.example` (create it if it doesn't exist, mirroring the `VITE_API_BASE_URL`/`VITE_GOOGLE_CLIENT_ID` vars already documented in `CLAUDE.md`).

---

## Phase 2: Foundational

**Purpose**: Shared schema, routes, and page scaffolding that every user story below reads from or renders into.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 [P] Extend `Backend/prisma/schema.prisma`: add `Units` enum (`KG`, `LB`) and `Appearance` enum (`LIGHT`, `DARK`); add `displayName String?`, `avatarUrl String?`, `avatarPublicId String?`, `unitsPreference Units @default(KG)`, `languagePreference String @default("en")`, `appearancePreference Appearance?` to `User`. No notification-related table (Notifications section is out of scope — research.md §2). Run `prisma db push` and `prisma generate` per project convention (data-model.md; no `migrations/` directory in this repo).
- [X] T004 [P] In `Backend/src/modules/users/users.controller.ts` and `Backend/src/modules/users/users.service.ts`, rename the existing baseline routes/methods: `GET/PATCH /profile` → `GET/PATCH /goals`, `getProfile`/`updateProfile` → `getGoals`/`updateGoals` (research.md §9). Pure rename — no behavior change to the baseline/BMR/TDEE logic.
- [X] T005 In `Frontend/src/pages/`, rename `Profile.tsx` → `Goals.tsx` (exported function `Profile` → `Goals`, same JSX/logic); update `Frontend/src/services/userService.ts`'s `getProfile`/`updateProfile` → `getGoals`/`updateGoals`, calling `/goals`; update the route path and import in `Frontend/src/App.tsx`; update the "Goals" nav entry's `to` in `Frontend/src/components/AppShell.tsx` to `/goals` (depends on T004 for the backend path to exist).
- [X] T006 Add `GET /profile/account` to `Backend/src/modules/users/users.controller.ts`/`users.service.ts`: composes `{ displayName, avatarUrl, unitsPreference, languagePreference, appearancePreference, hasPassword: !!user.passwordHash, googleLinked: !!user.googleSubjectId }` (depends on T003).
- [X] T007 [P] Create `Frontend/src/services/accountService.ts` with the `AccountProfile`, `Units`, `Appearance` types and a `getAccount()` function calling `GET /profile/account` (depends on T006).
- [X] T008 Add `UpdatePreferencesDto` (`unitsPreference?`, `languagePreference?`, `appearancePreference?`, all optional) and a `PATCH /profile/preferences` route/service method to `users.controller.ts`/`users.service.ts` — updates whichever fields are provided, returns the `GET /profile/account` shape. Shared by US2 (appearance) and US4 (units/language) (depends on T003).
- [X] T009 [P] Add `updatePreferences()` to `Frontend/src/services/accountService.ts` (depends on T007, T008).
- [X] T010 Create `Frontend/src/pages/Account.tsx` page shell: six `Card`-based sections with uppercase headers, in this order — ACCOUNT, PREFERENCES, APPEARANCE, SUPPORT, ABOUT, LOG OUT — each initially empty (filled in by the stories below), fetching `getAccount()` on mount. Add the protected `/account` route to `Frontend/src/App.tsx` (via the existing `AppPage`/`ProtectedRoute` wrapper) (depends on T007).
- [X] T011 [P] Add `Backend/test/users-account.e2e-spec.ts` covering `GET /profile/account`'s composed shape (defaults for a fresh user) and `PATCH /profile/preferences` (partial updates, validation failure on an invalid enum value) (depends on T006, T008).

**Checkpoint**: Foundation ready — every user story below can now be implemented.

---

## Phase 3: User Story 1 - One entry point for profile actions (Priority: P1) 🎯 MVP

**Goal**: A pinned avatar+name block at the bottom of the sidebar (and its mobile equivalent) replaces the old standalone Log out button and opens a small anchored dropdown (Profile/Account, Settings, Log out).

**Independent Test**: Sign in, confirm the profile block renders (initials avatar, since no photo yet) pinned below "Goals" and the old Log out button is gone; open the dropdown, confirm its three options and the divider before Log out; close it via outside-click and Escape; click Log out and confirm sign-out still works; check the mobile layout has an equivalent entry point.

### Implementation for User Story 1

- [X] T012 [P] [US1] Add a `SettingsIcon` (gear) to `Frontend/src/components/ui/icons.tsx` for the dropdown's "Settings" entry (reuse the existing `UserIcon` for "Profile/Account").
- [X] T013 [P] [US1] Create `Frontend/src/components/profile-menu/Avatar.tsx`: renders `avatarUrl` as an `<img>` when present, otherwise the user's initials (derived from `displayName`, falling back to the first letter of the username/email) on a deterministic colored background; accepts a `size` prop so it's reusable on the Account page (US3).
- [X] T014 [US1] Create `Frontend/src/components/profile-menu/ProfileMenu.tsx`: an avatar+name block (via `getAccount()` and `Avatar`) that toggles a dropdown anchored above it on click/tap, listing "Profile/Account" and "Settings" (both `Link`ing to `/account`) and "Log out" (divider above it, calls `useAuth().logout()`); closes on outside click and on Escape (depends on T007, T013).
- [X] T015 [US1] Update `Frontend/src/components/AppShell.tsx`: remove the standalone desktop Log out button and the mobile header's Log out icon button; mount `<ProfileMenu />` pinned to the bottom of the desktop sidebar (outside the scrollable nav list) and add an equivalent tappable entry point in the mobile layout (depends on T014).
- [X] T016 [US1] Manually verify per `quickstart.md` Story 1: click-anywhere opens the dropdown; outside-click and Escape close it; "Log out" behavior is unchanged; a user with no photo shows initials; the mobile layout has a reachable equivalent entry.

**Checkpoint**: User Story 1 is fully functional and independently testable.

---

## Phase 4: User Story 2 - Functional light/dark appearance toggle (Priority: P1)

**Goal**: A real, working Light/Dark toggle on the Account page that changes the whole app instantly and persists across reloads and, where signed in, across devices.

**Independent Test**: Toggle Light on the Account page, confirm the whole app switches immediately with no reload; reload and confirm it stays Light; clear `localStorage` while still signed in and confirm the account-stored preference restores Light on next load; check the pre-auth/OS-default fallback.

### Implementation for User Story 2

- [X] T017 [P] [US2] Add light theme token values under `:root[data-theme="light"]` in `Frontend/src/index.css`'s `@theme` block, mirroring every existing dark token (`--color-bg`, `--color-surface`, `--color-surface-raised`, `--color-text`, `--color-text-muted`, `--color-border`, `--color-accent*`, `--color-warn*`, `--holo-*`, `--shadow-card`) per research.md §3. Dark values stay the default/unscoped.
- [X] T018 [US2] Create `Frontend/src/context/ThemeContext.tsx`: resolves the active theme from `appearancePreference` (once `getAccount()` resolves) → a `localStorage` mirror → `window.matchMedia('(prefers-color-scheme: light)')` → dark fallback; sets `data-theme` on `document.documentElement`; exposes `theme`/`setTheme()`, where `setTheme()` writes `localStorage` immediately and calls `updatePreferences({ appearancePreference })` to persist server-side (depends on T009).
- [X] T019 [US2] Wrap the app with the new `ThemeProvider` in `Frontend/src/App.tsx`, reading any cached `localStorage` theme synchronously at module init (before first render) to avoid a flash of the wrong theme (depends on T018).
- [X] T020 [US2] Add the APPEARANCE section content to `Frontend/src/pages/Account.tsx`: a `SegmentedControl` Light/Dark toggle wired to `ThemeContext`'s `setTheme` (depends on T010, T018).
- [X] T021 [US2] Manually verify per `quickstart.md` Story 2: instant app-wide switch with no reload; persists on reload; restores from the account after clearing `localStorage`; falls back to the OS light/dark setting pre-auth.

**Checkpoint**: User Stories 1 AND 2 both work independently.

---

## Phase 5: User Story 3 - Manage core account details (Priority: P1)

**Goal**: Edit display name and photo (stored in Cloudinary), change/set a password, and view/manage Google account linkage — all from the ACCOUNT section.

**Independent Test**: Rename the account and confirm the sidebar updates immediately; upload a photo and confirm it replaces the initials avatar everywhere; reject an invalid file; change a password with the correct current password and confirm the new one works on next login; confirm a Google-only account is offered "set password" instead of "change"; confirm linking/unlinking Google works and unlinking is blocked when it's the only sign-in method.

### Backend for User Story 3

- [X] T022 [P] [US3] Fill in real `CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET` documentation/placeholders in `Backend/.env.example` (from T002) and add the `cloudinary` package to `Backend/package.json`.
- [X] T023 [P] [US3] Create `Backend/src/modules/users/cloudinary.service.ts` wrapping the `cloudinary` SDK: `createUploadSignature(userId)` (signed payload scoped to the `avatars/u_<userId>` folder, research.md §1), `verifyUpload(userId, publicId)` (confirms the asset exists under that folder before it's trusted), `destroyAsset(publicId)` (depends on T022).
- [X] T024 [P] [US3] Create `Backend/src/modules/users/dto/update-account.dto.ts` (`displayName`, 1–50 chars, trimmed) and `Backend/src/modules/users/dto/upload-avatar.dto.ts` (`url: string`, `publicId: string`).
- [X] T025 [P] [US3] Create `Backend/src/modules/users/dto/change-password.dto.ts` (`currentPassword: string`, `newPassword` ≥ 8 chars) and `Backend/src/modules/users/dto/set-password.dto.ts` (`newPassword` ≥ 8 chars).
- [X] T026 [US3] Add `updateDisplayName()` service method + `PATCH /profile/account` route to `users.service.ts`/`users.controller.ts` (depends on T024).
- [X] T027 [US3] Add `POST /profile/avatar/upload-signature` route/service calling `CloudinaryService.createUploadSignature` (depends on T023).
- [X] T028 [US3] Add `PATCH /profile/avatar` route/service: verify the upload via `CloudinaryService.verifyUpload`, destroy the previous asset if one existed, persist `avatarUrl`/`avatarPublicId` (depends on T023, T024).
- [X] T029 [US3] Add `DELETE /profile/avatar` route/service: `destroyAsset` via the stored `avatarPublicId`, clear both fields; idempotent if there was nothing to remove (depends on T023).
- [X] T030 [US3] In `Backend/src/modules/auth/auth.service.ts`, extract the existing Google ID-token verification inside `googleLogin()` into a reusable `verifyGoogleIdToken(idToken)` method — pure refactor, `googleLogin()`'s own behavior is unchanged.
- [X] T031 [US3] Add `changePassword()`/`PATCH /profile/password` (bcrypt-compare current, reject if `passwordHash` is null) and `setPassword()`/`POST /profile/password` (409 if `passwordHash` already set) to `users.service.ts`/`users.controller.ts`, reusing the `bcrypt.compare`/`bcrypt.hash` pattern already in `auth.service.ts` (depends on T025).
- [X] T032 [US3] Add `linkGoogleAccount()`/`POST /profile/google/link` (409 if that Google subject belongs to a different user) and `unlinkGoogleAccount()`/`DELETE /profile/google/link` (409 if `passwordHash` is null — lockout prevention) to `users.service.ts`/`users.controller.ts` (depends on T030).
- [X] T033 [P] [US3] Add/extend `Backend/test/users-account.e2e-spec.ts` covering: display-name update; avatar signature+confirm+remove (Cloudinary calls mocked); password change (correct/incorrect current password, no-password-yet case) and set (already-has-password conflict); Google link (already-linked-elsewhere conflict) and unlink (blocked when no password) (depends on T026–T032).
- [X] T034 [P] [US3] Add/extend `Backend/src/modules/users/users.service.spec.ts` unit tests for the same methods with Prisma, `CloudinaryService`, and `AuthService` mocked.

### Frontend for User Story 3

- [X] T035 [P] [US3] Extend `Frontend/src/services/accountService.ts` with `updateDisplayName`, `getAvatarUploadSignature`, `confirmAvatarUpload`, `removeAvatar`, `changePassword`, `setPassword`, `linkGoogleAccount`, `unlinkGoogleAccount`, and an `uploadToCloudinary(signature, file)` helper that `POST`s the file + signed fields directly to Cloudinary's `uploadUrl` via `fetch`/`FormData` (bypassing `apiClient`, which is only for our own API).
- [X] T036 [US3] Add the ACCOUNT section content to `Frontend/src/pages/Account.tsx`: display-name edit row; avatar row (reusing `Avatar` from T013, a file input driving the signature → direct Cloudinary upload → confirm flow, with a client-side image-type/size pre-check before requesting a signature); password row (renders "change" or "set" based on `hasPassword`); linked-accounts row (Google link/unlink, reusing the existing `GoogleSignInButton`'s underlying Google Identity Services flow) (depends on T010, T013, T035).
- [X] T037 [US3] Wire the display-name/avatar save actions from T036 to refresh `ProfileMenu`'s shown name/avatar without a full page reload (e.g. a small shared account-state hook or a refetch callback) (depends on T014, T036).
- [X] T038 [US3] Manually verify per `quickstart.md` Story 3: rename reflected in the sidebar immediately; avatar upload/replace/reject-invalid-file; both password flows (change vs. set); Google link and unlink, including the lockout-prevention block.

**Checkpoint**: User Stories 1, 2, AND 3 all work independently.

---

## Phase 6: User Story 4 - Units and language preferences (Priority: P2)

**Goal**: A units (kg/lb) toggle and a language selector in PREFERENCES, both persisted; units conversion is display-only everywhere weight is shown.

**Independent Test**: Switch units to lb, confirm weight values on the Goals and Progress pages redisplay converted; switch back and confirm the original kilogram value is exactly restored (no drift); confirm the choice persists across reload.

### Implementation for User Story 4

- [X] T039 [US4] Add the PREFERENCES section content to `Frontend/src/pages/Account.tsx`: a units `SegmentedControl` (kg/lb) and a language `Select`, both calling `updatePreferences()` (depends on T010, T009).
- [X] T040 [US4] Create `Frontend/src/utils/units.ts` (`kgToLb`, `formatWeight(valueKg, unit)`) and apply it to the weight displays in `Frontend/src/pages/Goals.tsx` and `Frontend/src/pages/WeightTrend.tsx`, reading `unitsPreference` from `getAccount()` (depends on T005, T007).
- [X] T041 [US4] In the PREFERENCES section (T039), show a "not yet fully supported" notice whenever `languagePreference` is outside a small server-known supported list (e.g. `["en"]`), per FR-020.
- [X] T042 [US4] Manually verify per `quickstart.md` Story 4: unit toggle converts displayed values without altering the underlying stored kilograms; language choice persists; unsupported-language notice shows correctly.

**Checkpoint**: User Stories 1–4 all work independently.

---

## Phase 7: User Story 5 - Support and About information (Priority: P3)

**Goal**: A feedback form that emails the team, a Help Center link, and an About section with app version and legal links — plus the page-level Log out row.

**Independent Test**: Submit feedback and confirm it's received by the configured support inbox; click Help Center and confirm it navigates somewhere useful; confirm About shows a version and working Terms/Privacy links.

### Implementation for User Story 5

- [X] T043 [P] [US5] Fill in `SUPPORT_EMAIL` documentation in `Backend/.env.example` (from T002); add `sendFeedbackEmail(subject, message, fromUserEmail)` to `Backend/src/modules/mail/mail.service.ts`, mirroring `sendWelcomeEmail`'s best-effort/logged-failure pattern.
- [X] T044 [US5] Add `Backend/src/modules/mail/dto/feedback.dto.ts` (`subject` 1–120 chars, `message` 1–2000 chars) and a `POST /support/feedback` route (guarded by the existing `JwtAuthGuard`) calling `sendFeedbackEmail` (depends on T043).
- [X] T045 [P] [US5] Add/extend `Backend/test/support-feedback.e2e-spec.ts` covering `POST /support/feedback`'s validation and best-effort send (mail transport mocked) (depends on T044).
- [X] T046 [P] [US5] Add `sendFeedback()` to `Frontend/src/services/accountService.ts`; wire up `VITE_HELP_CENTER_URL`/`VITE_TERMS_URL`/`VITE_PRIVACY_URL` (from T002) with in-repo fallbacks per research.md §8.
- [X] T047 [US5] Add the SUPPORT section (feedback form + Help Center link) and ABOUT section (app version read from `Frontend/package.json` at build time, Terms of Service / Privacy Policy links) content to `Frontend/src/pages/Account.tsx`, plus the distinctly-styled Log out row at the bottom of the page (reuses `useAuth().logout()`, muted/warning styling per FR-011) (depends on T010, T046).
- [X] T048 [US5] Manually verify per `quickstart.md` Story 5: feedback send, Help Center link, About content/links, bottom Log out row.

**Checkpoint**: All five user stories are independently functional.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T049 [P] Run `npm run lint` and `npm run build` from `Frontend/` to confirm no type/lint regressions across all frontend tasks.
- [X] T050 [P] Run `npm run lint`, `npm test`, and `npm run test:e2e` from `Backend/` to confirm no regressions and that all new tests (T011, T033, T034, T045) pass — per `CLAUDE.md`, e2e tests are not run in CI but must be run locally for any backend behavior change.
- [X] T051 Run the full `quickstart.md` validation across all five stories, plus the FR-025 regression check: Dashboard, Log food, Progress, and Goals (now at `/goals`) are visually/behaviorally unchanged; the old `/profile` URL no longer serves the baseline page; `/account` is a fully separate page from `/goals`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup (T002 supplies the env var names T022/T043 later fill in). Blocks every user story — `GET /profile/account`, the Account page shell, and the Goals rename are shared by all five stories.
- **User Stories (Phase 3–8)**: All depend on Foundational completion.
  - **US1** (Phase 3): No dependency on other stories.
  - **US2** (Phase 4): No dependency on other stories (uses T008's shared preferences endpoint from Foundational).
  - **US3** (Phase 5): No dependency on US2/US4/US5. One internal cross-story link: T037 (refresh the sidebar on save) assumes US1's `ProfileMenu` (T014) already exists — build US1 first, or at least before T037.
  - **US4** (Phase 6): Uses T008's shared preferences endpoint (Foundational) and T005's renamed `Goals.tsx`/`WeightTrend.tsx` targets — no dependency on US2/US3/US5.
  - **US5** (Phase 7): No dependency on other stories.
- **Polish (Phase 8)**: Depends on whichever of US1–US5 are completed.

### Recommended Execution Order

1. Phase 1 (Setup) → Phase 2 (Foundational) — required before anything else.
2. Phase 3 (US1) and Phase 4 (US2) — both P1, independent, can be done in either order or in parallel by different developers.
3. Phase 5 (US3) — P1, the largest story; do it after US1 exists (for T037's sidebar-refresh wiring) if working sequentially.
4. Phase 6 (US4) — P2, independent of US3.
5. Phase 7 (US5) — P3, independent of everything else.
6. Phase 8 (Polish).

### Parallel Opportunities

- T003 (schema) and T004 (Goals rename, backend) — different files, no dependency between them.
- T022–T025 (US3 backend scaffolding: env/deps, Cloudinary service, DTOs) can all be done in parallel — different files.
- T033/T034 (US3 backend tests) can run in parallel with each other and with T035 (US3 frontend service).
- US1 (Phase 3) and US2 (Phase 4) can be built in parallel by different developers once Foundational is done — they touch entirely separate files.
- US4 (Phase 6) and US5 (Phase 7) can both be built in parallel by different developers once Foundational (and, for US4's sidebar-adjacent pieces, US1) is done.
- T049 and T050 (Polish) can run in parallel — different apps.

---

## Parallel Example: User Story 3 backend scaffolding

```bash
# Once Foundational (Phase 2) is done, these four US3 setup tasks have no
# dependencies on each other:
Task: "Add CLOUDINARY_* env vars and the cloudinary package"
Task: "Create Backend/src/modules/users/cloudinary.service.ts"
Task: "Create update-account.dto.ts and upload-avatar.dto.ts"
Task: "Create change-password.dto.ts and set-password.dto.ts"
```

---

## Implementation Strategy

### MVP First (All Three P1 Stories)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational) — required for everything.
2. Complete Phase 3 (US1) — the entry point itself.
3. Complete Phase 4 (US2) — the explicitly "must be functional" appearance toggle.
4. Complete Phase 5 (US3) — the substantive Account content and the most security-relevant piece.
5. **STOP and VALIDATE**: run `quickstart.md` Stories 1–3 independently.
6. This trio (US1 + US2 + US3) is the MVP — all three are P1 and deliver everything the request named as core ("Profile/Account entry point," "functional dark/light toggle," "edit profile, change password, linked accounts").

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. US1 → validate → ship.
3. US2 → validate → ship.
4. US3 → validate → ship (MVP complete after these three).
5. US4 → validate → ship.
6. US5 → validate → ship.
7. Polish → final regression pass.

### Independent Test Criteria Recap

- **US1**: Profile block opens/closes its dropdown correctly; Log out behavior unchanged; mobile equivalent reachable.
- **US2**: Light/Dark switches instantly app-wide and persists (reload, cross-device, OS-default fallback).
- **US3**: Name/photo edits reflect immediately; password change/set both work correctly; Google link/unlink works with lockout prevention.
- **US4**: Units toggle converts display only (no data drift); language choice persists.
- **US5**: Feedback sends; Help Center/About links work; version displays.
