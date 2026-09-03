# Phase 0 Research: JWT Auth & Rate Limiting

## Context recap

Backend is NestJS 11 + Prisma (PostgreSQL/Neon), currently issuing a single
7-day JWT (HS256, `@nestjs/jwt` on `jsonwebtoken`) at signup/login/google-login
with no refresh flow, no revocation, and no request-rate limiting anywhere in
the app (`AuthService.issueSessionToken`, `AuthModule`, `main.ts`).

## Decision 1: Token signing algorithm — RS256 keypair + JWK, not shared-secret HS256

**Decision**: Switch access-token and refresh-token signing from HS256
(shared `JWT_SECRET`) to RS256, with **two separate asymmetric keypairs** —
one for access tokens, one for refresh tokens. Expose both public keys as a
JWKS via a `/auth/.well-known/jwks.json` endpoint, distinguished by `kid`.

Using two keypairs (rather than one shared keypair for both token types)
means either can be rotated independently: a compromised or soon-to-expire
refresh key can be rotated without invalidating every currently-live access
token, and vice versa. It also means an access token can never be
mistakenly accepted as a refresh token or vice versa purely by signature
validity — the wrong-key case fails at the `jwt.verify` step, not just on
downstream payload shape checks. See `src/modules/auth/keys.ts` (both
keypairs loaded/exported) and the `REFRESH_JWT_SERVICE` provider in
`auth.module.ts` (a second `JwtService` instance, separate from the default
one used for access tokens).

**Rationale**: The spec explicitly requires "JWT/JWK". A shared HS256 secret
has no JWK story — JWK/JWKS is meaningful only for asymmetric algorithms,
where the public half can be published for verification without exposing
signing capability. RS256 is the standard, broadly-supported choice for this
in the Node ecosystem and keeps `@nestjs/jwt`/`passport-jwt` usable unchanged
(they already support RS256 via `algorithm`/`secretOrKeyProvider` options).

**Alternatives considered**:
- Keep HS256 and just describe the secret informally as a "key" — rejected,
  doesn't satisfy the explicit JWK requirement and provides no verification
  endpoint for future service-to-service or third-party verification.
- ES256 (elliptic curve) — smaller keys/signatures, equally valid, but RS256
  has marginally simpler tooling/library support parity across the stack
  already in use (`jose`, `passport-jwt`) and no scale requirement favors EC
  here. Documented as a viable swap-in later if key size becomes a concern.

## Decision 2: Library for key/JWK handling — `jose`

**Decision**: Add the `jose` package to generate the RSA keypair (at boot, or
via a one-time script backed by env-provided PEM), export the public key as a
JWK, and serve it from the JWKS endpoint. Keep `@nestjs/jwt` + `passport-jwt`
for actually signing/verifying request-path tokens (they take a PEM
`privateKey`/`publicKey` pair directly), so the existing guard/strategy
plumbing is untouched.

**Rationale**: `jose` is the standard, actively-maintained library for
JWK/JWKS conversion in Node and has zero runtime dependencies. Re-deriving a
JWK from a PEM public key by hand is exactly the kind of thing it exists to
do correctly (RFC 7517/7518 compliance) without hand-rolling ASN.1 parsing.

**Alternatives considered**: `pem-jwk` (unmaintained, narrower scope, no JWKS
helpers) — rejected in favor of `jose`'s more complete, maintained API.

## Decision 3: Refresh token persistence & rotation model

**Decision**: Refresh tokens are JWTs (RS256, 7-day `expiresIn`, unique
`jti` claim), but each issued refresh token also gets a row in a new
`RefreshToken` table keyed by a hash of the token (not the raw token) plus
its `jti`. Verifying a refresh token requires both (a) a valid signature/
expiry and (b) a matching, non-revoked, non-expired DB row. Redeeming a
refresh token (via `POST /auth/refresh`) atomically marks that row revoked
and inserts a new one for the freshly-issued replacement token
("rotation"), per the spec's single-use Assumption. Logout revokes the
row(s) for the user's current session.

**Rationale**: A pure-JWT refresh token (verify signature/expiry only, no DB
check) cannot satisfy FR-005 (reject already-used or explicitly-invalidated
refresh tokens) or FR-006 (logout invalidates the refresh token) — JWTs are
stateless and can't be un-issued by signature verification alone. The DB
table is the actual state; the JWT is the transport format the client holds
carrying `jti` so we don't have to have the client send a raw DB id. Storing
a hash (not the raw token) means a DB read alone can't be replayed as a
credential, consistent with how `passwordHash` is already handled for
passwords in this codebase.

**Alternatives considered**:
- Purely stateless refresh tokens (no DB row) — rejected: cannot support
  logout invalidation or single-use rotation, both required by the spec.
- Store the raw refresh token in the DB instead of a hash — rejected on the
  same "don't store the credential in the clear" grounds already applied to
  `passwordHash`.

## Decision 4: Rate limiting — `@nestjs/throttler`, per-user key, global guard

**Decision**: Add `@nestjs/throttler`, configure one named limit `{ ttl:
300_000ms, limit: 50 }` (5 minutes / 50 requests), register `ThrottlerGuard`
globally (`APP_GUARD`), and override the default tracker so it keys on
`req.user.userId` when the request is authenticated (populated by
`JwtAuthGuard`/`JwtStrategy`) and falls back to the connection's IP address
otherwise (per spec Assumption on unauthenticated traffic).

**Rationale**: `@nestjs/throttler` is the maintained, first-party NestJS
rate-limiting module — it integrates with Nest's guard/interceptor pipeline,
supports a custom tracker function (needed for the per-user-not-per-IP
requirement in FR-010), and returns a standard `429 Too Many Requests` with
`Retry-After`-style headers out of the box, satisfying FR-008's "when will
you be able to send requests again" requirement without custom plumbing.

**Alternatives considered**:
- Hand-rolled interceptor + in-memory `Map` counters — rejected, reinvents
  what `@nestjs/throttler` already does correctly (sliding window semantics,
  header generation), more surface area to get wrong.
- `express-rate-limit` — designed for raw Express middleware, doesn't
  compose as naturally with Nest's DI/guard system or per-route override
  needs.

**Deployment note (documented, not a blocker)**: `@nestjs/throttler`'s
default storage is in-memory per-process. The current Railway deployment
(dashboard-managed, single instance) runs a single instance, so this is correct as-is. If the
service is ever scaled to multiple instances, the storage should move to a
shared store (e.g. `@nestjs/throttler`'s Redis adapter) so the 50/5min limit
is enforced across instances rather than per-instance — flagged here as a
future scaling note, not part of this feature's scope.

## Decision 5: Where the fixed-expiry, no-sliding-window behavior (FR-012) is enforced

**Decision**: Access tokens keep a flat `expiresIn: '30m'` at signing time
and are never re-signed or extended by request-handling code (no "sliding"
logic added anywhere). This is the default/absence-of-behavior outcome of
Decision 3+the existing `passport-jwt` `ignoreExpiration: false` strategy,
not new code — recorded here so it's traceable to the clarified requirement.

**Rationale**: Directly implements FR-012 (Option B, confirmed with user):
each access token's lifetime is fixed at issuance; only a refresh-token
exchange produces a new one.
