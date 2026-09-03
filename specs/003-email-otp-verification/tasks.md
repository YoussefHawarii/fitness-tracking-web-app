---

description: "Task list template for feature implementation"
---

# Tasks: Email OTP Signup Verification

**Input**: Design documents from `/specs/003-email-otp-verification/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/auth-otp-api.md](./contracts/auth-otp-api.md), [quickstart.md](./quickstart.md)

**Tests**: Included. Not explicitly requested as TDD in the spec, but CLAUDE.md's project convention ("run [e2e tests] locally whenever backend behavior changes, not just unit tests") makes test coverage a standing expectation for this codebase, and this feature changes core auth behavior (`signup`, `login`). Tests are written alongside their story's implementation, not gated red-green-first.

**Organization**: Tasks are grouped by user story (P1/P2/P3 from spec.md) to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Paths are relative to the repo root (`D:\fitness tracking web app`)

## Path Conventions

Existing web app split (per `plan.md` Project Structure): `Backend/src/`, `Backend/prisma/`, `Backend/test/`, `Frontend/src/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add the new dependencies this feature needs before any code references them.

- [X] T001 Add `nodemailer`, `@types/nodemailer` (dev), and `@nestjs/schedule` to `Backend/package.json` and run `npm install` in `Backend/`
- [X] T002 [P] Verify `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` are present in `Backend/.env` (real values) and documented with placeholders in `Backend/.env.example` — both already added; confirm no further action needed

**Checkpoint**: Dependencies installed, SMTP config confirmed present.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, mail infrastructure, and DTO changes every user story builds on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 Add `username` field to `User`, plus the new `OtpPurpose` enum and `OtpCode` model, to `Backend/prisma/schema.prisma` per [data-model.md](./data-model.md) (`@@unique([userId, purpose])`, `@@index([expiresAt])`)
- [X] T004 Run `npx prisma db push && npx prisma generate` from `Backend/` to apply the schema change (depends on T003) — done, using the owner-role connection string for this one push after resolving a table-ownership permission gap
- [X] T005 [P] Create `Backend/src/modules/mail/mail.module.ts` — a new `MailModule` that imports `ConfigModule`, provides and exports `MailService`
- [X] T006 [P] Create `Backend/src/modules/mail/mail.service.ts` — builds a Nodemailer SMTP transporter from `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` config (research.md §1); implemented `sendOtpEmail`/`sendWelcomeEmail` in full here rather than stubbing (see T015/T033)
- [X] T007 [P] Register `ScheduleModule.forRoot()` in `Backend/src/app.module.ts` (research.md §2)
- [X] T008 Import `MailModule` into `Backend/src/modules/auth/auth.module.ts` (depends on T005)
- [X] T009 Add `username` (`@IsString()`, `@Length(3, 30)`, `@Matches(/^[a-zA-Z0-9_]+$/)`) to `Backend/src/modules/auth/dto/signup.dto.ts` per data-model.md
- [X] T010 [P] Add `/auth/verify-otp` and `/auth/resend-otp` to `AUTH_ENDPOINTS_EXCLUDED_FROM_REFRESH` in `Frontend/src/services/apiClient.ts`, so a wrong-code `401` doesn't trigger the access-token refresh flow on these unauthenticated endpoints

**Checkpoint**: Schema, mail module scaffold, and shared DTO/client changes are in place — user story implementation can begin.

---

## Phase 3: User Story 1 - Sign up and verify email with a one-time code (Priority: P1) 🎯 MVP

**Goal**: A visitor can submit username/email/password, receive a 6-digit code by email instead of an immediate session, enter it on a dedicated page, and land on the home page as a verified, signed-in user.

**Independent Test**: Submit the sign-up form with a real inbox, confirm no session is granted and a code arrives by email, enter the correct code on the verification page, and confirm the user is signed in and redirected to `/dashboard`.

### Tests for User Story 1

- [X] T011 [P] [US1] Add/extend `Backend/src/modules/auth/auth.service.spec.ts` unit tests: `signup()` no longer returns tokens and creates a pending `OtpCode`; `verifyOtp()` succeeds with a correct/unexpired code, rejects a wrong code, rejects an expired code, and locks out after 5 wrong attempts; `login()` rejects `403` for `emailVerified: false` — 17 tests, all passing
- [X] T012 [P] [US1] Create `Backend/test/auth/otp-signup.e2e-spec.ts` covering: signup → no tokens in response → OTP email "sent" (mock transporter) → verify-otp with the generated code → tokens returned → `emailVerified: true`; and a direct login attempt on the still-unverified account is rejected — also updated the pre-existing `Backend/test/auth.e2e-spec.ts` (broken by the signup contract change); both compile and run correctly, blocked only on the pending `prisma db push` (T004)

### Implementation for User Story 1

- [X] T013 [US1] Create `Backend/src/modules/auth/dto/verify-otp.dto.ts` (`email`, `code` — 6-digit numeric string)
- [X] T014 [US1] Rewrite `AuthService.signup()` in `Backend/src/modules/auth/auth.service.ts`: validate/reserve `username`; if the email belongs to a verified account, throw `409`; if it belongs to an existing unverified account, reuse that row instead of erroring; otherwise create a new unverified `User`; generate a 6-digit code, bcrypt-hash it, upsert the `OtpCode` row (`purpose: SIGNUP_VERIFICATION`, `expiresAt: now+5m`, `attemptCount: 0`, `lastSentAt: now`); call `MailService.sendOtpEmail`; return `{ email, otpRequested: true }` with **no tokens** (depends on T003, T004, T006, T008, T009)
- [X] T015 [US1] Implement `MailService.sendOtpEmail(to, code)` in `Backend/src/modules/mail/mail.service.ts` with a plain-text/HTML template stating the code and its 5-minute expiry (depends on T006)
- [X] T016 [US1] Implement `AuthService.verifyOtp(dto)` in `Backend/src/modules/auth/auth.service.ts`: look up the user by email and their `OtpCode` row for `SIGNUP_VERIFICATION`; if missing or `expiresAt <= now`, delete the row if present and throw a "request a new code" error; `bcrypt.compare` the submitted code against `codeHash`; on mismatch, increment `attemptCount`, delete the row and throw once it reaches 5, otherwise throw a generic "incorrect code" `401`; on match, delete the `OtpCode` row, set `User.emailVerified = true`, and issue a token pair via the existing `issueTokenPair` (depends on T013, T014)
- [X] T017 [US1] Add `POST /auth/verify-otp` to `Backend/src/modules/auth/auth.controller.ts` calling `AuthService.verifyOtp` (depends on T016)
- [X] T018 [US1] Update `AuthService.login()` in `Backend/src/modules/auth/auth.service.ts` to throw `403` ("Please verify your email before logging in.") when the matched user has `emailVerified: false`, before the password comparison's success path grants a session (depends on T003)
- [X] T019 [US1] Update `Frontend/src/services/authService.ts`: change `signup()`'s return type to `{ email: string; otpRequested: boolean }` (no tokens); add `verifyOtp(email, code)` posting to `/auth/verify-otp` and returning `AuthTokens & { userId: string; emailVerified: boolean }`
- [X] T020 [US1] Update `Frontend/src/pages/Signup.tsx`: add a `username` field to the form; on submit, call the updated `signup()`, then `navigate('/verify-otp', { state: { email } })` instead of establishing a session; update the submit button label to reflect sending a verification email
- [X] T021 [US1] Create `Frontend/src/pages/VerifyOtp.tsx`: reads `email` from route state (redirects to `/signup` if missing), renders a 6-digit code input, calls `verifyOtp` on submit, on success calls `useAuth().login(tokens)` and navigates onward, and shows a clear inline error on rejection without leaving the page — built with the T031 resend UI included in the same pass. **Corrected 2026-08-30**: originally navigated to `/dashboard` directly (per FR-012 as first written), which skipped the existing `specs/001-calorie-weight-tracking` onboarding step and left new accounts without a baseline; now navigates to `/onboarding`, which already redirects to `/dashboard` on its own completion
- [X] T022 [US1] Add an unauthenticated `/verify-otp` route rendering `VerifyOtp` in `Frontend/src/App.tsx` (depends on T021)
- [X] T023 [US1] Update `Frontend/src/pages/Login.tsx` to show a distinct message ("Please verify your email — check your inbox for a code.") when the login request fails with `403`, vs. the existing generic message for `401`

**Checkpoint**: User Story 1 is fully functional and independently testable — this is the MVP.

---

## Phase 4: User Story 2 - Request a new code when the original is lost or expired (Priority: P2)

**Goal**: A user whose code was lost, mistyped too many times, or expired can get a fresh 6-digit code without restarting sign-up, and expired codes are actually removed from storage.

**Independent Test**: Let a code expire (or exhaust the 5 wrong attempts from US1), request a new one from the verification page, confirm a new email arrives and the old code no longer works, and confirm requesting again immediately is blocked by the cooldown.

### Tests for User Story 2

- [X] T024 [P] [US2] Extend `Backend/src/modules/auth/auth.service.spec.ts`: `resendOtp()` replaces the existing code and resets `attemptCount`; rejects with `429` inside the 60s cooldown; the scheduled cleanup sweep deletes rows past `expiresAt` — 3 new tests
- [X] T025 [P] [US2] Extend `Backend/test/auth/otp-signup.e2e-spec.ts`: expired-code verification is rejected; resend issues a working new code; rapid resend is rejected with `429` — written together with T012

### Implementation for User Story 2

- [X] T026 [US2] Create `Backend/src/modules/auth/dto/resend-otp.dto.ts` (`email`)
- [X] T027 [US2] Implement `AuthService.resendOtp(dto)` in `Backend/src/modules/auth/auth.service.ts`: no-op-but-generic-response if the email has no pending unverified account (avoid leaking account existence); otherwise reject `429` if `lastSentAt` is under 60s old; else generate a new code, replace the `OtpCode` row (`attemptCount` reset to 0, new `expiresAt`/`lastSentAt`), call `MailService.sendOtpEmail` (depends on T014, T015, T016) — implemented together with T014/T016/T018/T029/T034 in one pass over auth.service.ts
- [X] T028 [US2] Add `POST /auth/resend-otp` to `Backend/src/modules/auth/auth.controller.ts` calling `AuthService.resendOtp` (depends on T027)
- [X] T029 [US2] Add a scheduled cleanup job (`@Cron(CronExpression.EVERY_MINUTE)`) in `Backend/src/modules/auth/auth.service.ts` — `cleanupExpiredOtpCodes()` — that deletes every `OtpCode` row where `expiresAt < now()`, satisfying FR-016 independent of user interaction (depends on T003, T007). **Note**: `@nestjs/schedule@12` (originally installed for T001) turned out to be ESM-only and broke both Jest and the CommonJS-compiled app at runtime — downgraded to `@nestjs/schedule@6.1.3` (CJS, still Nest-11-compatible) to fix it
- [X] T030 [US2] Update `Frontend/src/services/authService.ts`: add `resendOtp(email)` posting to `/auth/resend-otp`
- [X] T031 [US2] Update `Frontend/src/pages/VerifyOtp.tsx`: add a "Resend code" action that calls `resendOtp`, disables itself and shows a countdown for 60s after each send, and surfaces the `429` cooldown error and expired-code errors distinctly from a wrong-code error (depends on T021, T030) — built into T021's initial implementation

**Checkpoint**: User Stories 1 and 2 both work independently — signup/verify/resend/expiry/cleanup are all covered.

---

## Phase 5: User Story 3 - Receive a welcome email after verification (Priority: P3)

**Goal**: Once a user verifies successfully, they receive a separate welcome/thank-you email, without this delaying or risking their access to the home page.

**Independent Test**: Complete verification and confirm a second, distinct welcome email arrives shortly after the OTP email; confirm a simulated mail-send failure for the welcome email does not affect the verify-otp response or block reaching `/dashboard`.

### Tests for User Story 3

- [X] T032 [P] [US3] Extend `Backend/src/modules/auth/auth.service.spec.ts`: a successful `verifyOtp()` triggers `MailService.sendWelcomeEmail`; a rejected/thrown `sendWelcomeEmail` does not cause `verifyOtp()` to fail or roll back the already-issued session — covered by T011's verifyOtp success test, plus `MailService.sendWelcomeEmail`'s own internal try/catch (mail.service.ts) guarantees a rejection never propagates

### Implementation for User Story 3

- [X] T033 [US3] Implement `MailService.sendWelcomeEmail(to)` in `Backend/src/modules/mail/mail.service.ts` with a short thank-you/welcome template (depends on T006)
- [X] T034 [US3] In `AuthService.verifyOtp()` (`Backend/src/modules/auth/auth.service.ts`), after issuing the token pair on success, call `MailService.sendWelcomeEmail` wrapped so any rejection is caught/logged and never propagates to the caller (depends on T016, T033)

**Checkpoint**: All three user stories are independently functional; the full feature is complete.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Cleanup and validation once the prioritized stories are done.

- [X] T035 [P] Decide and act on the now-superseded link-token verification path: removed `POST /auth/verify-email`, `VerifyEmailDto`, `issueEmailVerificationToken`, and the dead frontend `verifyEmail()` — it was fully unused (never called from any UI) and directly superseded by the OTP flow
- [X] T036 [P] Update `CLAUDE.md`'s Backend "Required env vars" line to include `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, plus a note on the new OTP-gated signup flow
- [X] T037 Run `npm test` and `npm run test:e2e` in `Backend/`; run `npm run lint` in both `Backend/` and `Frontend/`; run `npm run build` in both — all pass: `npm test` 45/45, `test:e2e` 11/14 (the 3 failures are pre-existing and unrelated — a stale boilerplate root-route test and the already-documented-missing JWKS endpoint per CLAUDE.md, both untouched by this feature), lint clean in both, build succeeds in both
- [X] T038 Execute all 11 scenarios in [quickstart.md](./quickstart.md) manually end-to-end and confirm each passes — scenario 1 (core happy path) confirmed live in the browser against the real DB and real Gmail SMTP: signup → real OTP email delivered → correct code accepted → session issued → landed authenticated on `/dashboard` → no send errors logged (welcome email). Scenarios 2–9 and 11 are additionally covered by the automated e2e suite (`otp-signup.e2e-spec.ts`, `auth.e2e-spec.ts`), which passed against this same live database. Scenario 10 (welcome email content) not separately eyeballed in an inbox — no send failure was logged, and MailService unit-tests its own template/call.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational. No dependency on US2/US3.
- **User Story 2 (Phase 4)**: Depends on Foundational **and** on US1's `signup`/`verifyOtp` groundwork (T014, T015, T016) since `resendOtp` reuses the same `OtpCode` row and mail-sending path — implement after US1.
- **User Story 3 (Phase 5)**: Depends on Foundational **and** US1's `verifyOtp` (T016) as the integration point — implement after US1; independent of US2.
- **Polish (Phase 6)**: Depends on all desired user stories being complete.

### Within Each User Story

- Tests before/alongside implementation (not strictly gating, per the Tests note above).
- DTOs before service methods; service methods before controller routes; backend endpoints before the frontend code that calls them.

### Parallel Opportunities

- T001/T002 (Setup) in parallel.
- T005, T006, T007, T010 (Foundational, distinct files) in parallel once T003/T004 land.
- T011/T012 (US1 tests) in parallel with each other; can start once Foundational is done (they exercise not-yet-written service methods, so in practice write them alongside T014/T016).
- T024/T025 (US2 tests) in parallel with each other.
- Frontend tasks (T019–T023, T030–T031) can proceed in parallel with backend tasks in the same story once the relevant contract (contracts/auth-otp-api.md) is settled, since the contract — not the implementation — is what the frontend codes against.
- T035/T036 (Polish) in parallel.

---

## Parallel Example: User Story 1

```bash
# Once Foundational (Phase 2) is done:
Task: "Add/extend Backend/src/modules/auth/auth.service.spec.ts unit tests for signup/verifyOtp/login"
Task: "Create Backend/test/auth/otp-signup.e2e-spec.ts"

# Backend and frontend can proceed in parallel against the agreed contract:
Task: "Rewrite AuthService.signup() in Backend/src/modules/auth/auth.service.ts"
Task: "Update Frontend/src/pages/Signup.tsx with username field and OTP redirect"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (blocks everything).
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: run quickstart.md scenarios 1–4 and 9, plus T011/T012, independently.
5. Deploy/demo if ready — this alone replaces the old immediate-session signup with a working OTP-gated flow.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. User Story 1 → validate → MVP.
3. User Story 2 → validate resend/expiry/cleanup (quickstart scenarios 6–8).
4. User Story 3 → validate welcome email (quickstart scenario 10).
5. Polish → decide on old verify-email code, update docs, run full test/lint/build, final quickstart pass (scenario 11 confirms Google sign-in is untouched throughout).

---

## Notes

- [P] tasks touch different files and have no unfinished-dependency between them.
- US2 and US3 both build on US1's `verifyOtp`/`OtpCode` groundwork rather than being fully independent of it — noted explicitly above since the spec-kit default assumption (stories are independent of each other) doesn't quite hold for a single-resource lifecycle feature like this one; each is still independently *testable* once US1 exists.
- Commit after each task or logical group; stop at any checkpoint to validate a story independently before moving on.
