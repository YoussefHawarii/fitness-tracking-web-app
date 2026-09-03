# Implementation Plan: Email OTP Signup Verification

**Branch**: `003-email-otp-verification` | **Date**: 2026-08-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-email-otp-verification/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Replace the current sign-up flow — which asks for email + password and grants an immediate session while emailing an unused 24h verification link — with a blocking, username + email + password sign-up that emails a 6-digit OTP (5-minute TTL, deleted from storage on expiry), routes the user to a dedicated verification page, only creates a session and a `dashboard` redirect once the correct code is entered, and follows that up with a separate welcome email. OTP delivery uses Nodemailer per stakeholder direction; existing Google sign-in is untouched.

## Technical Context

**Language/Version**: TypeScript 5 on Node.js 20 (Backend: NestJS 11; Frontend: React 19 + Vite)

**Primary Dependencies**: NestJS 11, Prisma, bcrypt, `class-validator`, `@nestjs/throttler` (existing); **new**: `nodemailer` for SMTP email delivery, `@nestjs/schedule` for periodic expired-OTP cleanup. Frontend reuses the existing `axios`-based `apiClient`, `react-router-dom` v7, and the existing UI kit (`Card`, `Input`, `PrimaryButton`) — no new frontend dependencies.

**Storage**: PostgreSQL via Prisma (Neon), using `prisma db push` (no `migrations/` directory, per project convention) — new `OtpCode` table plus a `username` column on `User`.

**Testing**: Backend — Jest unit tests (`*.spec.ts`, CI-enforced) and Jest e2e tests (`*.e2e-spec.ts`, run locally for behavior changes per project convention). Frontend has no test runner configured — verify manually via the dev server per project convention.

**Target Platform**: Web — Backend deployed on Railway, Frontend on Vercel.

**Project Type**: Web application (existing `Frontend/` + `Backend/` split).

**Performance Goals**: OTP email dispatched within the sign-up request's normal response time budget (no new latency targets beyond existing endpoints); SC-001 requires 95% of OTP emails delivered within 1 minute, which is an email-provider concern, not a request-latency one.

**Constraints**: OTP is exactly 6 digits; TTL is exactly 5 minutes and enforced by an actual delete (not just an `expiresAt` check) per FR-016; resend cooldown of 60s; max 5 incorrect attempts before the code is invalidated; unverified accounts cannot obtain a session (FR-014).

**Scale/Scope**: Small-scale app (existing single-tenant fitness tracker); no additional infrastructure beyond one new DB table, one new Nest module (`Mail`), and two new auth endpoints.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled placeholder template (confirmed both in CLAUDE.md and by reading the file) — it defines no ratified principles or gates to check against. This gate is treated as **N/A / automatically passed** for this feature; no complexity justification is required on that basis.

**Post-Phase 1 re-check**: Design artifacts (research.md, data-model.md, contracts/, quickstart.md) introduce one new DB table and one new backend module, both additive and consistent with existing patterns (Prisma `db push`, NestJS module-per-concern, bcrypt hashing). No new top-level project, no new architectural layer, no deviation requiring justification. Gate remains N/A / passed.

## Project Structure

### Documentation (this feature)

```text
specs/003-email-otp-verification/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── auth-otp-api.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
Backend/
├── prisma/
│   └── schema.prisma            # + username on User, + OtpCode model
├── src/
│   └── modules/
│       ├── auth/
│       │   ├── auth.controller.ts   # + POST verify-otp, + POST resend-otp; signup/login updated
│       │   ├── auth.service.ts      # signup no longer issues a session; OTP generate/check/cleanup
│       │   ├── auth.module.ts       # imports MailModule, ScheduleModule
│       │   └── dto/
│       │       ├── signup.dto.ts    # + username
│       │       ├── verify-otp.dto.ts    # new
│       │       └── resend-otp.dto.ts    # new
│       └── mail/                    # new module
│           ├── mail.module.ts
│           ├── mail.service.ts      # Nodemailer transport, sendOtpEmail, sendWelcomeEmail
│           └── mail.service.spec.ts
└── test/
    └── auth/
        └── otp-signup.e2e-spec.ts   # new e2e coverage for the OTP flow

Frontend/
├── src/
│   ├── pages/
│   │   ├── Signup.tsx            # + username field, submit → request OTP → navigate
│   │   └── VerifyOtp.tsx         # new: 6-digit code entry page
│   ├── services/
│   │   └── authService.ts        # signup() no longer returns tokens; + verifyOtp(), + resendOtp()
│   └── App.tsx                   # + /verify-otp route (unauthenticated)
```

**Structure Decision**: Existing `Backend/` (NestJS modules) + `Frontend/` (React pages/services) split is reused as-is — this is a web application with pre-existing frontend/backend separation (CLAUDE.md), so Option 2 (web application) applies. No new top-level directories; the feature adds one new backend module (`mail/`) alongside the existing `auth/` and `users/` modules, and one new frontend page (`VerifyOtp.tsx`) alongside the existing `Signup.tsx`/`Login.tsx`.

## Complexity Tracking

*No constitution gates apply (see Constitution Check above — placeholder/unratified), so no violations require justification.*
