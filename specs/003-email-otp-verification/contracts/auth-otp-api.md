# Phase 1 Interface Contracts: `auth` module changes (Email OTP Verification)

High-level endpoint contracts for the modified/new `auth`-module routes this feature introduces. Documents shape and behavior, not a full OpenAPI spec — exact route/DTO naming is an implementation detail for `/speckit-tasks`. Unlisted `auth` endpoints (`/auth/refresh`, `/auth/logout`, `/auth/google`) are unchanged by this feature.

## `auth` module

| Endpoint | Method | Request | Response | Notes |
|---|---|---|---|---|
| `/auth/signup` | POST | username, email, password, timezone | `{ email, otpRequested: true }` — **no tokens** | **Changed.** No session issued (FR-004). Rejects `409` if username taken (FR-002) or email belongs to a verified account (FR-003). If email belongs to an existing *unverified* account, reuses it and issues a fresh OTP instead of erroring (spec Edge Cases). Creates/replaces the user's `OtpCode` row and sends the 6-digit code by email. |
| `/auth/verify-otp` | POST | email, code (6 digits) | JWT (access + refresh) + userId, `emailVerified: true` | **New.** Validates the code against the stored hash, checks `expiresAt > now()` and `attemptCount < 5` (FR-005, FR-009, FR-015). On success: deletes the `OtpCode` row, sets `User.emailVerified = true`, issues a session, and triggers the welcome email (FR-011, FR-012, FR-013). On failure: increments `attemptCount` (deleting the row and returning a "request a new code" error once it hits 5) and returns `401` without a session. |
| `/auth/resend-otp` | POST | email | `{ otpRequested: true }` | **New.** Rejects `429` if under 60s since the last send for that user (FR-010). Otherwise replaces the existing `OtpCode` row with a fresh 6-digit code/expiry and re-sends the email. No-ops safely (same generic response) if the email doesn't correspond to a pending unverified account, to avoid leaking account existence. |
| `/auth/login` | POST | email, password | JWT (access + refresh) | **Changed.** Now additionally rejects `403` ("Please verify your email before logging in.") when the matched account has `emailVerified: false` (FR-014), instead of granting a session — same generic `401` as before for wrong credentials, so a `403` only ever confirms *correct* credentials on an unverified account, not their existence to an attacker. |

## Email side-effects (not HTTP endpoints, but part of the contract)

| Trigger | Email sent | Notes |
|---|---|---|
| `/auth/signup` succeeds (new or reused pending account) | OTP email — 6-digit code, mentions 5-minute expiry | Sent via `MailService.sendOtpEmail` (Nodemailer). Failure to send surfaces as a `502`/error from `/auth/signup` — user must retry (spec Edge Cases: "user sees an error on the sign-up page and can retry"). |
| `/auth/resend-otp` succeeds | Same OTP email template, new code | |
| `/auth/verify-otp` succeeds | Welcome/thank-you email | Sent via `MailService.sendWelcomeEmail`, best-effort/non-blocking (FR-013, spec Assumptions) — a failure here does **not** fail the `/auth/verify-otp` response or roll back the session already issued. |

## Cross-cutting contract notes

- `/auth/verify-otp` and `/auth/resend-otp` are **unauthenticated** endpoints (identified by `email`, not a bearer token) — matches the Frontend routing decision that `/verify-otp` is reached before any session exists (plan.md Project Structure).
- Rate limiting: the existing global `UserThrottlerGuard` (50 req / rolling 5 min, keyed by IP for unauthenticated routes) still applies to all `auth` routes unchanged; the OTP-specific 60s resend cooldown (FR-010) is an additional, narrower business rule layered on top, not a replacement.
- No endpoint in this contract ever returns the raw/hashed OTP code or reveals whether a given email exists in the system beyond what `/auth/signup`'s own username/email conflict responses already reveal today.
