# Implementation Plan: Sidebar Profile Entry & Account/Settings Page

**Branch**: `008-sidebar-profile-account` | **Date**: 2026-09-01 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/008-sidebar-profile-account/spec.md`

## Summary

Add a pinned avatar+name profile block to the bottom of the existing sidebar (and an equivalent entry on mobile), replacing the current standalone Log out button, that opens a small anchored dropdown (Profile/Account, Settings, Log out). Both "Profile/Account" and "Settings" route to one new page at `/account`, built from the app's existing `Card`/`Input`/`Select`/`SegmentedControl`/`Button` primitives, organized into six labeled sections (Account, Preferences, Appearance, Support, About, Log out — no Notifications section; see below). Because the user confirmed "full build," this is a genuine full-stack feature: new `User` fields (display name, avatar URL, units/language/appearance preferences), three new/extended backend modules (`users` gains profile-photo/preferences endpoints, a new password-change endpoint, a new Google link/unlink pair reusing the existing `OAuth2Client` verification already used by login), a new client-side theme system (there is currently no light palette or theme-switching mechanism at all — this feature introduces both), and a signed direct-to-Cloudinary upload flow for avatar photos. As part of removing any naming ambiguity between this feature and the pre-existing "Goals" page (which happened to live at `/profile`), that unrelated page is renamed to `/goals` (frontend and backend) as part of this feature — a naming-only change, per research.md §9. A Notifications section (daily log-reminder email) was originally planned but explicitly dropped by request — no reminder-sending capability is being built.

## Technical Context

**Language/Version**: TypeScript 5 across both apps (Frontend: React 19 + Vite; Backend: Node.js + NestJS 11)

**Primary Dependencies**: Frontend — react-router-dom v7, Tailwind CSS v4, existing `apiClient` (axios), existing UI primitives (`Card`, `Input`, `Select`, `SegmentedControl`, `PrimaryButton`, `SecondaryButton`, icon set), existing `GoogleSignInButton`/Google Identity Services script (reused for the "link Google account" action), existing `AuthContext`, a direct browser `fetch` to Cloudinary's upload API (no Cloudinary JS SDK needed client-side — a signed multipart POST is sufficient). Backend — NestJS 11, Prisma ORM, `class-validator`, `bcrypt` (already used for password hashing in `auth.service.ts`), `google-auth-library`'s `OAuth2Client` (already used for Google login, reused for link/unlink), existing `MailService`/Nodemailer (reused only for the feedback path — no notification-sending use), and a new `cloudinary` npm dependency (server-side signature generation + destroy calls only, per research.md §1).

**Storage**: Postgres via Prisma. New columns on `User` (`displayName`, `avatarUrl`/`avatarPublicId`, `unitsPreference`, `languagePreference`, `appearancePreference`). No notification-preference table — the Notifications section was dropped from scope (research.md §2). Schema changes applied via `prisma db push` per project convention (no `migrations/` directory). Avatar image bytes themselves live in **Cloudinary**, not Postgres — only the resulting URL and public ID are stored (research.md §1).

**Testing**: Backend — Jest unit tests (`*.spec.ts`, CI) and Jest e2e tests (`*.e2e-spec.ts`, run locally for this behavior change, per `CLAUDE.md`). Frontend — no automated test runner configured (`Frontend/package.json` has no `test` script); verification is manual against `quickstart.md` plus `npm run build`/`npm run lint`.

**Target Platform**: Web browser (Frontend on Vercel, Backend on Railway).

**Project Type**: Web application — existing `Frontend/` + `Backend/` split; no new projects.

**Performance Goals**: Appearance switching must feel instant (<1s, no reload — SC-002). Avatar photo upload should complete within a few seconds on a typical connection for images at the defined size cap; no other special performance targets beyond existing app norms.

**Constraints**: Reuse existing UI primitives and the existing dark theme's design tokens rather than inventing new ones (per spec FR-012) — the light theme must be built as a second value for the *same* CSS custom properties already defined in `Frontend/src/index.css`'s `@theme` block, not a parallel styling system. Avatar photos are stored in Cloudinary via a signed direct-upload flow (research.md §1), requiring three new backend env vars (`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`). Must not change the Dashboard, Log food, Progress, or Goals pages' content/behavior (FR-025) — the Goals page (currently at `/profile`, unrelated to this feature) is renamed to `/goals` (frontend and backend) purely to remove the naming collision, per research.md §9; nothing about what it shows or does changes.

**Scale/Scope**: One new frontend page, one new sidebar sub-component (profile block + dropdown), one new theme mechanism, and backend additions scoped to the existing `users` module (plus a small extension to `auth` for the Google link/unlink token verification reuse) and `mail` module. No new top-level apps or services.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled placeholder template (per `CLAUDE.md`, not a ratified set of principles) — there are no project-specific principles to gate against. No violations to track; Complexity Tracking section is not needed.

## Project Structure

### Documentation (this feature)

```text
specs/008-sidebar-profile-account/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── account-settings-api.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
Backend/
├── .env.example                                # add CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET
├── prisma/
│   └── schema.prisma                           # extend User model only — no NotificationPreference table
└── src/
    └── modules/
        ├── users/
        │   ├── dto/
        │   │   ├── update-account.dto.ts       # NEW — displayName
        │   │   ├── upload-avatar.dto.ts        # NEW — url/publicId from a completed Cloudinary upload
        │   │   ├── change-password.dto.ts      # NEW — currentPassword?/newPassword
        │   │   ├── set-password.dto.ts         # NEW — newPassword (Google-only accounts)
        │   │   └── update-preferences.dto.ts   # NEW — units/language/appearance
        │   ├── users.controller.ts             # RENAME routes: /profile → /goals (existing baseline);
        │   │                                    # add new account/settings routes under /profile/...
        │   ├── users.service.ts                # rename getProfile/updateProfile → getGoals/updateGoals;
        │   │                                    # add corresponding new service methods
        │   └── cloudinary.service.ts            # NEW — signed upload payload + destroy, wraps `cloudinary` SDK
        ├── auth/
        │   └── auth.service.ts                  # expose a reusable verifyGoogleIdToken() for link/unlink
        └── mail/
            └── mail.service.ts                  # add sendFeedbackEmail() only — no reminder-sending method

Frontend/
├── src/
│   ├── components/
│   │   ├── AppShell.tsx                         # remove standalone Log out; mount ProfileMenu; nav "Goals" → /goals
│   │   └── profile-menu/
│   │       ├── ProfileMenu.tsx                  # NEW — avatar+name block + anchored dropdown
│   │       └── Avatar.tsx                       # NEW — photo (avatarUrl) or initials-on-color
│   ├── context/
│   │   └── ThemeContext.tsx                     # NEW — light/dark state, persistence, OS-default fallback
│   ├── pages/
│   │   ├── Goals.tsx                            # RENAMED from Profile.tsx — same content, /goals route
│   │   └── Account.tsx                          # NEW — the 6-section settings page
│   └── services/
│       ├── userService.ts                       # rename getProfile/updateProfile → getGoals/updateGoals, call /goals
│       └── accountService.ts                    # NEW — account/password/avatar/preferences/feedback calls
```

**Structure Decision**: Existing `Frontend/` + `Backend/` layout is unchanged (Option 2: Web application). All backend additions land inside the existing `users`, `auth`, and `mail` modules; all frontend additions are new files inside the existing `components/`, `context/`, `pages/`, and `services/` directories — no new top-level directories.

## Complexity Tracking

*No constitution violations — section not needed.*
