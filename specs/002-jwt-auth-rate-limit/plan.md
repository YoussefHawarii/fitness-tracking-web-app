# Implementation Plan: JWT Auth & Rate Limiting

**Branch**: `002-jwt-auth-rate-limit` | **Date**: 2026-08-28 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-jwt-auth-rate-limit/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Replace the backend's current single 7-day HS256 access token with a
30-minute RS256 access token + 7-day RS256 refresh token pair, published via
a JWKS endpoint (JWT/JWK per the spec's technical constraint); add
refresh-token rotation and revocation (a new `RefreshToken` table) so tokens
can be invalidated on logout or reuse; and add a global per-user (per-IP if
unauthenticated) rate limit of 50 requests per rolling 5-minute window via
`@nestjs/throttler`. See [research.md](research.md) for the five technical
decisions this is built on.

## Technical Context

**Language/Version**: TypeScript 5.7, Node.js (NestJS 11)

**Primary Dependencies**: `@nestjs/jwt`, `@nestjs/passport` + `passport-jwt`
(existing, reused for RS256), `@nestjs/config`, Prisma 6 / `@prisma/client`
(existing); **new**: `jose` (JWK/JWKS generation), `@nestjs/throttler`
(rate limiting)

**Storage**: PostgreSQL via Prisma (Neon) — existing; adds one new table
(`RefreshToken`, see [data-model.md](data-model.md))

**Testing**: Jest (unit specs) + Supertest (`test/*.e2e-spec.ts`) — existing
harness, no new tooling

**Target Platform**: Linux server (Railway), single instance (dashboard-managed config)

**Project Type**: Web service (backend-only change; no frontend work in this
feature's scope beyond consuming the new response shape, which is
backward-incompatible — see Complexity Tracking)

**Performance Goals**: No explicit new throughput target; rate limiter and
JWT verification must not add perceptible latency to existing request paths
(target: single-digit-ms overhead, consistent with in-memory
`@nestjs/throttler` storage and `passport-jwt`'s existing signature-check
cost)

**Constraints**: Access token fixed 30-minute expiry, no sliding renewal
(FR-012); refresh token fixed 7-day expiry, single-use/rotated (FR-005,
Assumptions); rate limit exactly 50 requests / rolling 5 minutes, keyed per
authenticated user or per IP when unauthenticated (FR-007, FR-010, FR-011)

**Scale/Scope**: Existing single-Railway-instance deployment; in-memory rate
limiter storage is correct at this scale (documented scaling note in
[research.md](research.md) Decision 4 if the deployment ever becomes
multi-instance)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template (no
ratified project principles exist yet) — there are no gates to evaluate
against. Nothing to check; not a violation, just an absent constitution.

## Project Structure

### Documentation (this feature)

```text
specs/002-jwt-auth-rate-limit/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── auth-api.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
Backend/
├── prisma/
│   └── schema.prisma          # + RefreshToken model, + User.refreshTokens relation
├── src/
│   ├── config/
│   │   └── config.module.ts   # unchanged; new env vars read via existing ConfigService
│   ├── common/
│   │   ├── guards/
│   │   │   └── jwt-auth.guard.ts   # unchanged (RS256 is transparent to passport-jwt)
│   │   └── decorators/
│   │       └── current-user.decorator.ts  # unchanged
│   ├── modules/
│   │   └── auth/
│   │       ├── auth.controller.ts     # + POST /refresh, + POST /logout, + GET /.well-known/jwks.json
│   │       ├── auth.service.ts        # token issuance/verification/rotation logic changes
│   │       ├── auth.module.ts         # JwtModule RS256 config, RefreshToken repo wiring
│   │       ├── dto/
│   │       │   └── refresh-token.dto.ts   # new
│   │       ├── strategies/
│   │       │   └── jwt.strategy.ts    # secretOrKey -> public key (RS256)
│   │       └── keys.ts                # new: loads/derives RSA keypair + JWK
│   └── main.ts                        # unchanged (guard registration happens via AppModule providers)
│   └── app.module.ts                  # + ThrottlerModule, + APP_GUARD (ThrottlerGuard)
└── test/
    └── auth.e2e-spec.ts / *.spec.ts   # new/updated tests per quickstart.md scenarios
```

**Structure Decision**: Existing single-backend NestJS project
(`Backend/`); no new services or directories at the top level. All changes
live inside the existing `modules/auth` feature module plus one new
cross-cutting piece (`ThrottlerModule` registered in `app.module.ts`, since
the rate limit applies globally across all modules, not just auth).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No constitution violations (no ratified constitution exists to violate).

One noteworthy non-gate tradeoff, recorded for transparency: the
`/auth/signup`, `/auth/login`, `/auth/google` response shape changes
(single `accessToken` → `accessToken` + `refreshToken`). This is a breaking
change for any existing client (the `Frontend/` app). It's accepted as
necessary because the spec requires a refresh-token flow, and there is no
way to add refresh tokens without changing what login-family endpoints
return. Frontend adoption of the new field is out of this feature's scope
(backend-only per Technical Context) but should be tracked as an immediate
follow-up so the frontend isn't left calling an API it can't fully use.
