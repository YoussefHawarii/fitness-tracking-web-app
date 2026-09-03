# Phase 1 Data Model: Email OTP Signup Verification

Extends the existing schema in `Backend/prisma/schema.prisma` (see `model User` and `model UserBaseline` there for full current context). Only the changed/new pieces are shown below.

## `User` (modified)

| Field | Type | Notes |
|---|---|---|
| `id` | `String` (uuid) | Unchanged. |
| `username` | `String` | **New.** Unique, 3–30 chars, `^[a-zA-Z0-9_]+$`. Required for email/password sign-up; Google-only accounts created via `googleLogin` do not currently collect one (out of scope — see spec Assumptions on Google sign-in being unaffected) and can leave it unset. |
| `email` | `String` | Unchanged — unique. |
| `emailVerified` | `Boolean` | Unchanged field, **behavior changed**: for email/password accounts this now gates login/session issuance (FR-014) rather than being informational only. |
| `passwordHash` | `String?` | Unchanged. |
| `googleSubjectId` | `String?` | Unchanged. |
| `timezone` | `String` | Unchanged. |
| `createdAt` | `DateTime` | Unchanged. |
| `otpCodes` | `OtpCode[]` | **New relation.** |

**Validation rules**:
- `username` uniqueness enforced at the DB level; violated inserts surface as `409 Conflict` (FR-002).
- `email` uniqueness enforced as today; a sign-up attempt against an email that already belongs to a **verified** account is rejected before any OTP is issued (FR-003).
- A sign-up attempt against an email with an existing **unverified, pending** account does not create a duplicate row — it reuses that account and issues a fresh OTP (spec Edge Cases).

## `OtpCode` (new)

| Field | Type | Notes |
|---|---|---|
| `id` | `String` (uuid) | Primary key. |
| `userId` | `String` | FK → `User.id`, `onDelete: Cascade`. One active row per user (see below). |
| `codeHash` | `String` | bcrypt hash of the 6-digit code (research.md §3) — never store the raw code. |
| `purpose` | `OtpPurpose` (enum) | `SIGNUP_VERIFICATION` for this feature; the enum exists so future OTP uses (e.g. password reset) don't require a schema migration. |
| `expiresAt` | `DateTime` | `createdAt + 5 minutes`, per FR-009. |
| `attemptCount` | `Int` | Starts at `0`; incremented on each wrong guess; row is deleted once it reaches `5` (FR-015). |
| `lastSentAt` | `DateTime` | Timestamp the code (or its most recent resend) was emailed; drives the 60s resend cooldown. |
| `createdAt` | `DateTime` | `@default(now())`. |

**Constraints / relationships**:
- `@@unique([userId, purpose])` — at most one active OTP per user per purpose at a time; requesting a new code (initial send or resend) replaces the existing row for that `(userId, purpose)` pair rather than accumulating rows.
- `@@index([expiresAt])` — supports the scheduled cleanup sweep's `WHERE expiresAt < now()` deletion (research.md §2).

**State transitions**:

```
(no row) --signup / resend--> PENDING(expiresAt=+5m, attemptCount=0)
PENDING --wrong code, attemptCount<5--> PENDING(attemptCount+=1)
PENDING --wrong code, attemptCount reaches 5--> (row deleted; user must resend)
PENDING --correct code, before expiresAt--> (row deleted; User.emailVerified=true, session issued)
PENDING --expiresAt reached (read-time check or cron sweep)--> (row deleted; user must resend)
PENDING --resend requested (>=60s since lastSentAt)--> (row replaced with a new PENDING; old code invalidated)
```

**Validation rules**:
- `codeHash` MUST correspond to exactly 6 digits before hashing (FR-005) — validated in the DTO/service layer, not the DB.
- Any read of an `OtpCode` for verification purposes MUST additionally check `expiresAt > now()`, independent of whether the cleanup sweep has already run (research.md §2, belt-and-suspenders).

## Prisma sketch (illustrative, not the final migration)

```prisma
enum OtpPurpose {
  SIGNUP_VERIFICATION
}

model OtpCode {
  id           String     @id @default(uuid())
  userId       String
  user         User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  codeHash     String
  purpose      OtpPurpose
  expiresAt    DateTime
  attemptCount Int        @default(0)
  lastSentAt   DateTime   @default(now())
  createdAt    DateTime   @default(now())

  @@unique([userId, purpose])
  @@index([expiresAt])
  @@map("otp_codes")
}
```

Applied via `prisma db push` + `prisma generate`, per project convention (no `migrations/` directory).
