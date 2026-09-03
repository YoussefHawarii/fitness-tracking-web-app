# Phase 0 Research: Email OTP Signup Verification

No `NEEDS CLARIFICATION` markers remain in the Technical Context — the stack, storage, and testing approach all follow directly from the existing codebase (CLAUDE.md, `Backend/package.json`, `Backend/prisma/schema.prisma`). This document instead records the key technical decisions made while turning the spec's requirements into a concrete design, since several of them had more than one reasonable implementation.

## 1. OTP delivery transport

**Decision**: Use `nodemailer` with SMTP transport, configured via new environment variables (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`), wrapped in a new `MailModule`/`MailService` in `Backend/src/modules/mail/`.

**Rationale**: Explicitly directed by the stakeholder (spec Assumptions). SMTP transport (vs. a provider-specific API like SendGrid/SES SDKs) keeps the dependency surface to just `nodemailer` and matches the project's existing "free-tier friendly" services pattern (Neon, USDA free API) — any SMTP provider (Gmail app password, Mailtrap for dev, etc.) works without further code changes.

**Alternatives considered**:
- A transactional email API (SendGrid, Postmark, Resend) — rejected because the user explicitly asked for Nodemailer.
- Queue-based async email dispatch (BullMQ + Redis) — rejected as unnecessary infrastructure for this app's scale; direct `await transporter.sendMail(...)` inside the request is consistent with how the app already does synchronous external calls (e.g. Google token verification, USDA lookups).

## 2. OTP storage & TTL enforcement (FR-009, FR-016)

**Decision**: A new `OtpCode` Prisma model storing a bcrypt-hashed 6-digit code, `purpose` (`SIGNUP_VERIFICATION` or, structurally reusable later, other purposes), `expiresAt`, and `attemptCount`, keyed to a `userId`. Enforcement of the 5-minute TTL is **two-layered**:
1. **Read-time**: every verify/resend check filters on `expiresAt > now()` — an expired row is never treated as valid even if not yet physically deleted.
2. **Delete-time**: expired rows are deleted (a) opportunistically whenever that user's OTP row is touched (verify attempt, resend, new signup) and is found expired, and (b) via a scheduled sweep (`@nestjs/schedule` `@Cron` every minute) that deletes any `OtpCode` where `expiresAt < now()`, guaranteeing FR-016 holds even if the user never comes back to interact with it.

**Rationale**: Satisfies FR-016 ("no stale codes remain queryable") without requiring a durable job queue — `@nestjs/schedule` is a lightweight, already-idiomatic-for-NestJS in-process cron that needs no new infrastructure (no Redis, no external scheduler), matching this project's minimal-ops footprint (Render + Neon, no worker infra). The opportunistic delete keeps the common case (user verifies well within 5 minutes) free of any dependency on the cron actually having run yet.

**Alternatives considered**:
- Postgres `expiresAt` + relying solely on filtered reads, never physically deleting — rejected because the spec explicitly says "got deleted from DB", not just logically expired.
- Native Postgres `TTL`/row expiry (not a stable feature) or a `pg_cron` extension — rejected as unavailable/unconfirmed on the Neon free tier and adds a DB-side dependency outside Prisma's `db push` workflow.
- Storing the OTP in-memory (e.g. a Map keyed by userId) instead of the DB — rejected: doesn't survive a server restart/redeploy (Render redeploys are common), and the spec explicitly frames this as a DB-resident, DB-deleted record.

## 3. Hashing the OTP at rest

**Decision**: Hash the 6-digit code with `bcrypt` (already a project dependency, same pattern as `passwordHash`) before storing it, and compare with `bcrypt.compare` on verification.

**Rationale**: A 6-digit code is low-entropy (1,000,000 possibilities), but hashing still follows the principle of least exposure if the DB is ever read/dumped, and reuses a dependency and pattern (`BCRYPT_SALT_ROUNDS`) already established in `auth.service.ts` — no new crypto dependency needed. Combined with the 5-attempt lockout (FR-015) and 5-minute TTL, this keeps brute-force risk low regardless.

**Alternatives considered**: Storing the code in plaintext — rejected as an unnecessary weakening for negligible implementation savings; SHA-256 (as already used for refresh-token hashing) — viable, but bcrypt was chosen for consistency with the other "short secret compared against a hash" case (`passwordHash`) already in the codebase.

## 4. Session-gating for unverified accounts (FR-004, FR-014)

**Decision**: `POST /auth/signup` no longer returns `accessToken`/`refreshToken`. It creates a `User` row (`emailVerified: false`, no `passwordHash` exposed) plus an `OtpCode` row, sends the OTP email, and returns only a non-sensitive acknowledgement (e.g. `{ email, otpRequested: true }`). Session tokens are issued for the first time by the new `POST /auth/verify-otp` endpoint, once the code checks out. `POST /auth/login` additionally now rejects (`403`) with a clear message if `emailVerified` is `false`, so an abandoned pending signup can't be logged into directly (its owner instead needs to trigger a fresh OTP via `POST /auth/resend-otp` — see spec Edge Cases).

**Rationale**: This is a direct, minimal reading of FR-004/FR-011/FR-014 — the current codebase's signup (spec 002) issues tokens immediately and treats verification as a non-blocking side flow (a stale `TODO: deliver via an email provider` on the old `verificationToken` field, never wired to real email). This feature supersedes that behavior for the email/password path specifically; Google sign-in (`googleLogin`) is untouched since Google already asserts email ownership (spec Assumptions).

**Alternatives considered**: Keep issuing a session at signup and only gate specific app routes behind `emailVerified` — rejected because it contradicts FR-004 ("System MUST NOT create an authenticated session immediately") and FR-003's acceptance scenario ("no session is created yet").

## 5. Resend cooldown & attempt lockout (FR-010, FR-015)

**Decision**: Track `lastSentAt` and `attemptCount` on the `OtpCode` row itself (no separate table). `POST /auth/resend-otp` rejects with `429` if `lastSentAt` is under 60 seconds old; issuing a new code always replaces (deletes + recreates, or updates in place) the existing row and resets `attemptCount` to 0. `POST /auth/verify-otp` increments `attemptCount` on each wrong guess and deletes the row once it hits 5, so a subsequent verify attempt correctly reports "no active code" and directs the user to request a new one.

**Rationale**: Keeps the whole OTP lifecycle in one row/table, avoiding a second table or an in-memory rate-limit store; the existing `@nestjs/throttler`-based `UserThrottlerGuard` already rate-limits by user/IP at 50 req/5 min globally, so the OTP-specific 60s cooldown is a business rule layered on top of (not a replacement for) that general abuse protection.

**Alternatives considered**: A dedicated `@nestjs/throttler` route-level limiter just for `resend-otp` — viable but redundant with a simple timestamp check that also has to exist anyway for the "expired code → offer resend" UX.

## 6. Username field (FR-001, FR-002)

**Decision**: Add `username String @unique` to the `User` model, validated in `SignupDto` with `class-validator` (`@IsString()`, `@Length(3, 30)`, `@Matches(/^[a-zA-Z0-9_]+$/)`). Uniqueness is enforced at the DB level (`@unique`) and surfaced as a `409 Conflict` from the signup endpoint, checked before any OTP email is sent (per the spec's Edge Cases: "rejected with a clear message before any email is sent").

**Rationale**: Matches the "reasonable defaults" the spec's Assumptions already documented (3–30 chars, standard conventions) and mirrors how `email` uniqueness is already handled in this schema (`@unique` + `ConflictException`).

**Alternatives considered**: Making username optional/display-only (not unique) — rejected, since the spec explicitly calls out "reject sign-up if the username is already in use" (FR-002) as a functional requirement, not just a UX nicety.
