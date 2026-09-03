# Quickstart: Validating Email OTP Signup Verification

Validation guide only — proves the three prioritized user stories from `spec.md` work end-to-end. Implementation steps belong in `tasks.md` (from `/speckit-tasks`), not here.

## Prerequisites

- Node.js 20 LTS, npm
- A PostgreSQL connection string (Neon free-tier project, per `docs/technical-decisions.md`)
- SMTP credentials the app can send mail through (an Ethereal/Mailtrap test inbox is sufficient for validation — no production mail provider required)
- Access to the inbox tied to the SMTP `to` address used during manual testing, to read the received OTP/welcome emails

## Setup

```bash
# from repo root
cd Backend && npm install nodemailer @nestjs/schedule
cd Backend && npm install
cd ../Frontend && npm install
```

Configure environment variables (backend, `.env`): `DATABASE_URL`, `ACCESS_TOKEN`, `REFRESH_TOKEN`, `USDA_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PORT` (existing) plus new `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. Configure environment variables (frontend): `VITE_API_BASE_URL`, `VITE_GOOGLE_CLIENT_ID` (unchanged).

```bash
# apply schema (adds username on User, adds OtpCode) — project convention is db push, not migrate
cd Backend && npx prisma db push && npx prisma generate
```

## Run

```bash
# backend
cd Backend && npm run start:dev

# frontend
cd Frontend && npm run dev
```

## Validation Scenarios (map to `spec.md` Acceptance Scenarios)

1. **Core signup-to-verified flow (User Story 1)**: On the sign-up page, submit a username, a real/test email, and a password. Confirm you are **not** signed in yet and are redirected to a verification page referencing that email (`contracts/auth-otp-api.md` `/auth/signup`). Check the mailbox for a 6-digit code. Enter it on the verification page; confirm you land on the account setup page (`/onboarding`) as a signed-in user (`/auth/verify-otp`), and that completing it (age/sex/height/weight/goal/activity level, per `specs/001-calorie-weight-tracking`) lands you on the home page (`/dashboard`).
2. **Wrong code retry (User Story 1)**: On the verification page, enter an incorrect 6-digit code. Confirm you see an error and remain on the page able to try again, without a session being created.
3. **Attempt lockout (User Story 1, Edge Case)**: Enter an incorrect code 5 times in a row for the same signup. Confirm the code is invalidated and a 6th attempt (even with the originally-correct code) is rejected, requiring a resend.
4. **Duplicate username/email (User Story 1, Edge Case)**: Attempt to sign up with a username already used by another test account — confirm it's rejected before any email is sent. Attempt to sign up again with an email that already belongs to a fully verified account — confirm it's rejected and directed to log in.
5. **Pending-account re-signup (User Story 1, Edge Case)**: Start a signup, abandon it before verifying, then submit the sign-up form again with the same email. Confirm a fresh OTP is sent for the same pending account rather than an error.
6. **Resend after expiry (User Story 2)**: Wait for a requested code's 5-minute TTL to pass (or use a shortened TTL in a local test build), then attempt to verify with it — confirm it's rejected as expired. Request a new code from the verification page; confirm a new email arrives and the old code stays rejected.
7. **Resend cooldown (User Story 2)**: Immediately after requesting a code, request another one right away. Confirm the system blocks the rapid repeat request until ~60 seconds have passed.
8. **TTL deletion from storage (spec FR-016)**: After a code's 5-minute TTL elapses, inspect the `otp_codes` table (e.g. via `npx prisma studio` or a direct query) and confirm the row for that code no longer exists, rather than merely being marked expired.
9. **Blocked login while unverified (spec FR-014)**: Sign up, do not complete verification, then attempt to log in directly with that email/password on the login page. Confirm login is rejected with a message to verify email first, and no session is granted.
10. **Welcome email (User Story 3)**: Complete verification successfully and confirm a second, distinct welcome/thank-you email arrives in the same inbox shortly after the OTP email, and that this arrival does not delay or block reaching the home page.
11. **Google sign-in unaffected**: Sign in via the existing Google OAuth path with a fresh Google account and confirm it still grants immediate access with no OTP step, unchanged from before this feature.

## Expected Outcome

All eleven scenarios pass, and the existing `/auth/refresh`, `/auth/logout`, and `/auth/google` behavior remains unchanged (verify existing Backend Jest unit/e2e suites for those still pass: `npm test` and `npm run test:e2e` from `Backend/`).
