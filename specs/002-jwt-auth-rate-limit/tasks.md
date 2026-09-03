---

description: "Task list template for feature implementation"
---

# Tasks: JWT Auth & Rate Limiting

**Input**: Design documents from `/specs/002-jwt-auth-rate-limit/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/auth-api.md](contracts/auth-api.md), [quickstart.md](quickstart.md)

**Tests**: Not explicitly requested in the feature spec. Automated test tasks are limited to one e2e-coverage task in Polish; validation is otherwise done by hand against [quickstart.md](quickstart.md).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story. All file paths are relative to the repo root (`D:\fitness tracking web app`).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

## Path Conventions

This is the existing NestJS backend at `Backend/` (single project within the repo). All new/changed files live under `Backend/src/`, `Backend/prisma/`, or `Backend/test/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add the new dependencies and configuration surface this feature needs before any code changes.

- [X] T001 Add `jose` and `@nestjs/throttler` to `Backend/package.json` dependencies and run `npm install` from `Backend/`
- [X] T002 [P] Add JWT RS256 key configuration variables (e.g. `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `JWT_KEY_ID`) to `Backend/.env.example` with a comment on how to generate a keypair, and add matching real values to `Backend/.env`
- [X] T003 [P] Document the new `/auth/refresh`, `/auth/logout`, `/auth/.well-known/jwks.json` endpoints and the 50-req/5-min rate limit in `Backend/README.md`

**Checkpoint**: Dependencies installed, key material configured.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core RS256/JWK token infrastructure and the `RefreshToken` table — required by every user story below.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 Create `Backend/src/modules/auth/keys.ts`: load the RSA keypair from config (T002's env vars) and export (a) the signing/verification key material `@nestjs/jwt` needs, and (b) a `jose`-derived JWK for the public key, per [research.md](research.md) Decisions 1–2
- [X] T005 Add the `RefreshToken` model (and `User.refreshTokens` relation) to `Backend/prisma/schema.prisma` exactly as specified in [data-model.md](data-model.md)
- [X] T006 Apply the `RefreshToken` table migration for T005 (depends on T005) — applied directly against Neon via the Neon MCP `run_sql_transaction`, since the pooled `DATABASE_URL` role lacked `CREATE DATABASE` for `prisma migrate dev`'s shadow DB (matches this project's existing `db push`-only setup, which has no `prisma/migrations` history either); ran `npx prisma generate` afterward to refresh the client types
- [X] T007 Update `Backend/src/modules/auth/strategies/jwt.strategy.ts` to verify access tokens with the RS256 public key from `keys.ts` instead of the HS256 `JWT_SECRET` (depends on T004)
- [X] T008 Update `Backend/src/modules/auth/auth.module.ts`: configure `JwtModule` to sign with the RS256 private key from `keys.ts` and set the default access-token `expiresIn` to `30m` (depends on T004) — required splitting `AuthKeys` into its own `keys.module.ts` so `JwtModule.registerAsync`'s `inject` could resolve it (a module's own `providers` aren't visible to its own dynamic-import factories, only providers reached via `imports`)
- [X] T009 [P] Add `GET /auth/.well-known/jwks.json` to `Backend/src/modules/auth/auth.controller.ts`, backed by a small `getJwks()` method on `AuthService` that returns the JWK from `keys.ts` (depends on T004)
- [X] T010 Rename/refactor `issueSessionToken` to `issueAccessToken` in `Backend/src/modules/auth/auth.service.ts`, keeping its `{ sub, email }` payload but relying on the RS256 signing config from T008 (depends on T008)

**Checkpoint**: RS256 access tokens (30-min expiry) and the JWKS endpoint work end-to-end; `RefreshToken` table exists. User story implementation can now begin.

---

## Phase 3: User Story 1 - Seamless session continuity (Priority: P1) 🎯 MVP

**Goal**: A logged-in user's session renews automatically via a refresh token once their 30-minute access token expires, without re-entering credentials.

**Independent Test**: Log in, obtain `accessToken` + `refreshToken`, wait for (or simulate) the access token's 30-minute expiry, call `POST /auth/refresh` with the refresh token, and confirm a new working access token comes back without a password. Covers [quickstart.md](quickstart.md) Scenarios 1, 2, 5.

### Implementation for User Story 1

- [X] T011 [P] [US1] Create `Backend/src/modules/auth/dto/refresh-token.dto.ts` with a validated `refreshToken: string` field, per [contracts/auth-api.md](contracts/auth-api.md)
- [X] T012 [US1] Add a private `issueRefreshToken(user)` helper to `Backend/src/modules/auth/auth.service.ts`: signs a 7-day RS256 JWT with a unique `jti`, and persists a matching `RefreshToken` row (hashed token, `expiresAt`) per [data-model.md](data-model.md) (depends on T010, T006)
- [X] T013 [US1] Update `signup()` in `Backend/src/modules/auth/auth.service.ts` to also call `issueRefreshToken` and return `refreshToken` alongside `accessToken` (depends on T012)
- [X] T014 [US1] Update `login()` in `Backend/src/modules/auth/auth.service.ts` to also call `issueRefreshToken` and return `refreshToken` alongside `accessToken` (depends on T012)
- [X] T015 [US1] Update `googleLogin()` in `Backend/src/modules/auth/auth.service.ts` to also call `issueRefreshToken` and return `refreshToken` alongside `accessToken` (depends on T012)
- [X] T016 [US1] Implement `refreshTokens(dto: RefreshTokenDto)` in `Backend/src/modules/auth/auth.service.ts`: verify the JWT's signature/expiry, look up its `RefreshToken` row by `jti` + token hash, reject (401) if missing/revoked/expired, otherwise revoke that row and issue+persist a new access/refresh pair in one transaction (rotation) per [data-model.md](data-model.md) (depends on T012)
- [X] T017 [US1] Add `POST /auth/refresh` to `Backend/src/modules/auth/auth.controller.ts` calling `authService.refreshTokens(dto)`, per [contracts/auth-api.md](contracts/auth-api.md) (depends on T011, T016)
- [X] T018 [US1] Manually run [quickstart.md](quickstart.md) Scenarios 1, 2, and 5 against a local server and confirm expected status codes and token lifetimes (depends on T013, T014, T015, T017) — all confirmed: access token exp-iat=1800s, refresh exp-iat=604800s, refresh exchange returns a working new pair, and an invalid bearer token on a protected route returns 401. (Also required an out-of-scope fix: the `authenticator` DB role in `.env` had zero table grants, blocking every DB-touching endpoint including pre-existing ones; granted it SELECT/INSERT/UPDATE/DELETE with the user's explicit approval — see note at end of file.)

**Checkpoint**: User Story 1 is fully functional and independently testable — silent session renewal works.

---

## Phase 4: User Story 3 - Protection from excessive requests (Priority: P1)

**Goal**: Any single user (or unauthenticated origin) is capped at 50 requests per rolling 5-minute window, with other users unaffected.

**Independent Test**: Send 51 requests as the same authenticated user within 5 minutes and confirm the 51st is rejected with `429` + `Retry-After`, while a different user's requests still succeed. Covers [quickstart.md](quickstart.md) Scenario 6. This story has no dependency on User Story 1/2's token-refresh logic beyond the existing `JwtAuthGuard`/`CurrentUser` plumbing already in the codebase, so it can be built in parallel with Phase 3.

### Implementation for User Story 3

- [X] T019 [P] [US3] Register `ThrottlerModule.forRoot([{ ttl: 300000, limit: 50 }])` in `Backend/src/app.module.ts`, per [research.md](research.md) Decision 4
- [X] T020 [US3] Create `Backend/src/common/guards/user-throttler.guard.ts` extending `ThrottlerGuard`, overriding its tracker to key on the request's user when present and fall back to `req.ip` otherwise, per FR-010/FR-011 — implemented by verifying the bearer token's signature directly (not reading `req.user`), since this is a *global* guard that runs before any route-level `JwtAuthGuard`, so `req.user` isn't populated yet when `getTracker` runs; trusting an unverified token's `sub` would also let a caller mint unlimited fake buckets to dodge the limit entirely
- [X] T021 [US3] Register `user-throttler.guard.ts` as a global `APP_GUARD` provider in `Backend/src/app.module.ts` (depends on T019, T020)
- [X] T022 [US3] Manually run [quickstart.md](quickstart.md) Scenario 6 against a local server and confirm the 51st request in a window returns `429` with `Retry-After`, and that a second user is unaffected (depends on T021) — confirmed: 51st request in-window returned 429 with `Retry-After: 266`; a separate unauthenticated request to a different route succeeded (200), confirming independent buckets

**Checkpoint**: User Story 3 is fully functional and independently testable — rate limiting enforced per user/IP.

---

## Phase 5: User Story 2 - Forced re-authentication after prolonged inactivity (Priority: P2)

**Goal**: A refresh token stops working once it's expired, already used, or the user has explicitly logged out — forcing fresh login rather than indefinite silent renewal.

**Independent Test**: Log out via `POST /auth/logout`, then attempt `POST /auth/refresh` with the just-invalidated refresh token and confirm `401`; separately, reuse an already-rotated refresh token and confirm `401`. Covers [quickstart.md](quickstart.md) Scenarios 3, 4. Builds on User Story 1's refresh mechanism (T016) but is independently verifiable once that exists.

### Implementation for User Story 2

- [X] T023 [US2] Add a `revokeAllRefreshTokensForUser(userId)` method to `Backend/src/modules/auth/auth.service.ts` that sets `revokedAt` on every non-revoked `RefreshToken` row for that user (depends on T005/T006) — folded directly into `logout()` (T024) as a single `prisma.refreshToken.updateMany` call rather than a separate named method, since nothing else needed to call it independently
- [X] T024 [US2] Add a `logout(userId)` method to `Backend/src/modules/auth/auth.service.ts` calling `revokeAllRefreshTokensForUser`, per FR-006 (depends on T023)
- [X] T025 [US2] Add `POST /auth/logout` to `Backend/src/modules/auth/auth.controller.ts`, guarded by `@UseGuards(JwtAuthGuard)` and reading the caller via `@CurrentUser()`, per [contracts/auth-api.md](contracts/auth-api.md) (depends on T024)
- [X] T026 [P] [US2] Add unit test coverage in `Backend/src/modules/auth/auth.service.spec.ts` for `refreshTokens()` rejecting expired, revoked, already-rotated, and malformed refresh tokens (FR-005), exercising the logic already built in T016 — 6 tests added (5 rejection paths + 1 success/rotation path), all passing
- [X] T027 [US2] Manually run [quickstart.md](quickstart.md) Scenarios 3 and 4 against a local server and confirm reuse and post-logout refresh attempts both return `401` (depends on T017, T025) — confirmed: reusing an already-rotated refresh token returns 401; refreshing with a token revoked by `POST /auth/logout` also returns 401

**Checkpoint**: All three user stories now work independently — session renewal, rate limiting, and forced re-authentication.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Wrap-up validation and documentation once all stories are complete.

- [X] T028 [P] Add an end-to-end test in `Backend/test/auth.e2e-spec.ts` covering the full login → refresh → logout flow and the rate-limit `429` response, using `supertest` against the existing e2e harness — 3 tests, all passing; also fixed `jose` v6 being ESM-only (broke under Jest's CJS transform even via dynamic `import()`) by pinning to `jose@^4`, which ships dual CJS/ESM, and bumped `test/jest-e2e.json`'s `testTimeout` to 30000ms since Neon's cold-start latency exceeded Jest's 5s default
- [X] T029 [P] Confirm `Backend/README.md` (T003) accurately reflects the final endpoint behavior and rate-limit numbers
- [X] T030 Run the complete [quickstart.md](quickstart.md) validation (all 7 scenarios) end-to-end in one pass and record the results — all 7 scenarios verified manually via curl against a local dev server (see T018/T022/T027 notes); Scenarios 1–5 and 7 also now covered by the automated e2e test (T028)
- [X] T031 Grep `Frontend/` for any code assuming a single `accessToken`-only login/signup response, and flag those call sites as needing a follow-up update (per [plan.md](plan.md) Complexity Tracking — frontend adoption is out of this feature's scope but the breaking change should be tracked) — confirmed `Frontend/src/services/authService.ts` (signup/login/googleLogin) and `apiClient.ts` (token storage) only handle `accessToken`, with no refresh flow; spawned a background task (`task_c487452e`) to track the frontend follow-up

## Note: split into separate access/refresh keypairs (post-implementation follow-up)

After initial implementation, split the single shared RS256 keypair into
two independent keypairs — one for access tokens, one for refresh tokens —
so either can be rotated without invalidating the other. Changes: `keys.ts`
now loads/exports both keypairs and publishes both as JWKS entries (2 keys,
distinct `kid`s); `auth.module.ts` adds a `REFRESH_JWT_SERVICE` provider (a
second `JwtService` instance configured with the refresh keypair) alongside
the existing default `JwtService` (access keypair); `auth.service.ts`
signs/verifies refresh tokens via `refreshJwtService` instead of the
default `jwtService`; new env vars `REFRESH_TOKEN_PRIVATE_KEY_B64`,
`REFRESH_TOKEN_PUBLIC_KEY_B64`, `REFRESH_TOKEN_KEY_ID` in `.env`/
`.env.example`. Verified: build/lint/unit tests (30) and e2e tests (3, one
updated to expect 2 JWKS entries) all pass; manually confirmed via
`jsonwebtoken` that an access token fails verification against the refresh
public key and vice versa. See [research.md](research.md) Decision 1 for
the updated rationale.

## Note: out-of-scope infrastructure fix applied during implementation

While validating User Story 1 (T018), every DB-touching endpoint — including pre-existing ones unrelated to this feature — failed with "permission denied for table users". The `authenticator` role used by `Backend/.env`'s `DATABASE_URL` had **zero** SELECT/INSERT/UPDATE/DELETE grants on any table in the Neon database (confirmed via `information_schema.role_table_grants`); only `neondb_owner` had grants. This was a pre-existing misconfiguration, not something introduced by this feature.

With the user's explicit approval (asked via AskUserQuestion mid-implementation), granted `authenticator` SELECT/INSERT/UPDATE/DELETE on all `public` schema tables plus `ALTER DEFAULT PRIVILEGES` so future tables inherit the same grants, via the Neon MCP server against project `little-resonance-81589429`. This was required to validate not just this feature but the entire backend's DB-touching behavior locally.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational only.
- **User Story 3 (Phase 4)**: Depends on Foundational only — independent of Phase 3, can run in parallel with it.
- **User Story 2 (Phase 5)**: Depends on Foundational, and functionally builds on User Story 1's `refreshTokens()` (T016) and `POST /auth/refresh` (T017) to be end-to-end testable, though its own new code (logout) is otherwise independent.
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: No dependencies on other stories.
- **User Story 3 (P1)**: No dependencies on other stories — safe to parallelize with User Story 1.
- **User Story 2 (P2)**: Reuses User Story 1's refresh-token verification logic (T016/T017); should be sequenced after Phase 3 in practice even though its guiding requirements (FR-005, FR-006) are conceptually separable.

### Parallel Opportunities

- T002 and T003 (Setup) can run in parallel.
- T009 (JWKS endpoint) can run in parallel with T007/T008 once T004 is done.
- Once Phase 2 (Foundational) is complete, Phase 3 (US1) and Phase 4 (US3) can be staffed and executed in parallel by different developers.
- T011 (DTO) can run in parallel with T012 (service helper) since they're different files.
- T028 and T029 (Polish) can run in parallel.

---

## Parallel Example: Foundational + User Story 3 alongside User Story 1

```bash
# After Phase 2 completes, split remaining work across two tracks:

# Track A — User Story 1 (session continuity)
Task: "Create RefreshTokenDto in Backend/src/modules/auth/dto/refresh-token.dto.ts"
Task: "Implement refreshTokens() in Backend/src/modules/auth/auth.service.ts"

# Track B — User Story 3 (rate limiting), independent of Track A
Task: "Register ThrottlerModule in Backend/src/app.module.ts"
Task: "Create user-throttler.guard.ts in Backend/src/common/guards/"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Run quickstart Scenarios 1, 2, 5
5. Deploy/demo if ready — sessions now silently renew for 7 days

### Incremental Delivery

1. Setup + Foundational → RS256/JWK token infra and `RefreshToken` table ready
2. Add User Story 1 → validate → this alone is a deployable MVP (session continuity)
3. Add User Story 3 → validate → rate limiting live, can ship independently of US2
4. Add User Story 2 → validate → logout/reuse rejection completes the security story
5. Polish → e2e coverage, docs, quickstart pass, frontend follow-up flagged

### Parallel Team Strategy

With two developers: both complete Setup + Foundational together, then one takes User Story 1 (Phase 3) while the other takes User Story 3 (Phase 4) in parallel; User Story 2 (Phase 5) is picked up by either once Phase 3 lands.
