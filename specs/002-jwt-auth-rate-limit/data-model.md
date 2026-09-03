# Phase 1 Data Model: JWT Auth & Rate Limiting

## Entities

### RefreshToken (new Prisma model)

Backs the "Renewal Credential" entity from the spec. Represents the
persisted, revocable state behind an issued refresh JWT; the JWT itself
(held by the client) is never stored — only a hash of it.

| Field       | Type       | Notes |
|-------------|------------|-------|
| `id`        | `String` (uuid, PK) | Also embedded in the refresh JWT as its `jti` claim, so a presented token maps to exactly one row. |
| `userId`    | `String` (FK → `User.id`, cascade delete) | Owner of the credential. |
| `tokenHash` | `String` | SHA-256 hash of the raw refresh JWT. Never store the raw token (mirrors `passwordHash` treatment elsewhere in this schema). |
| `expiresAt` | `DateTime` | Set to issuance time + 7 days; mirrors the JWT's own `exp` but kept redundantly so revocation queries don't need to decode the token. |
| `revokedAt` | `DateTime?` | Null while active. Set on logout (FR-006) or on successful rotation (superseded by a new token, Assumption: single-use). |
| `createdAt` | `DateTime` (default now) | Issuance time, for audit/debugging. |

**Indexes**: `@@index([userId])` (logout must revoke all of a user's active
rows — see Validation rules); `@@unique` on `id` is implicit as PK.

**Validation rules** (enforced in `AuthService`, not the DB):
- A refresh attempt is accepted only if: the JWT signature/expiry verify
  **and** a `RefreshToken` row exists with matching `id`/`tokenHash`,
  `revokedAt IS NULL`, and `expiresAt > now()`. (FR-005)
- On successful refresh: the presented row's `revokedAt` is set to now() and
  a new `RefreshToken` row + JWT are issued in the same DB transaction
  (rotation; Assumption: single-use per renewal).
- On logout: every `RefreshToken` row for `userId` with `revokedAt IS NULL`
  is revoked, not just the one presented — a user's "log out" should end all
  of that request's session state, and the spec's edge case about
  multi-device sessions is scoped as "limit applies per user across
  devices," not "logout on one device silently orphans other devices'
  tokens as still-valid-but-unlisted." Only the request's own refresh
  session is what logout is defined over in this feature; no new
  cross-device-logout requirement is introduced.
- Expired but not-yet-revoked rows are inert (rejected by the `expiresAt`
  check) and may be opportunistically deleted by a periodic cleanup — not
  required for correctness, noted as a possible future task, not part of
  this feature's scope.

### Access token (not persisted)

No new table. Stays exactly what it is today (a signed JWT payload of
`{ sub: userId, email }`), except: signed RS256 instead of HS256, and
`expiresIn` changes from `7d` to `30m`. Fully stateless and unchanged in
verification path (`JwtStrategy`/`JwtAuthGuard`).

### Request Count Window (not persisted — in-memory via `@nestjs/throttler`)

Not a Prisma entity. Tracked in-process by `@nestjs/throttler`'s storage,
keyed by `userId` (authenticated) or client IP (unauthenticated), rolling
5-minute window, cap 50. See [research.md](research.md) Decision 4 for the
single-instance-deployment scoping note.

## Relationships

```
User (1) ──── (0..n) RefreshToken
```

Existing `User` model gains one new relation field (`refreshTokens
RefreshToken[]`); no changes to any other existing model.

## Prisma schema diff (illustrative — applied via migration in implementation phase)

```prisma
model User {
  // ...existing fields unchanged...
  refreshTokens RefreshToken[]
}

model RefreshToken {
  id         String    @id @default(uuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String
  expiresAt  DateTime
  revokedAt  DateTime?
  createdAt  DateTime  @default(now())

  @@index([userId])
  @@map("refresh_tokens")
}
```
