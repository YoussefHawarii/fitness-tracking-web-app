# API Contract: Auth token issuance, refresh, and JWKS

Base path: `/auth` (existing `AuthController`). All request/response bodies
are JSON. All endpoints are subject to the global rate limit (50 req / 5 min
per user or, if unauthenticated, per IP) described in
[../research.md](../research.md) Decision 4.

## Changed: token-issuing responses

`POST /auth/signup`, `POST /auth/login`, `POST /auth/google` already exist
and are unchanged in request shape. Their **response** shape changes from a
single `accessToken` to an access/refresh pair:

```jsonc
// 200/201 response (signup/login/google — shape now shared)
{
  "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6Ii4uLiJ9...",
  "refreshToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6Ii4uLiJ9...",
  "userId": "..."
  // ...other existing fields (emailVerified, verificationToken) unchanged
}
```

- `accessToken`: RS256 JWT, `exp` = issuance + 30 minutes. (FR-001, FR-012)
- `refreshToken`: RS256 JWT, `exp` = issuance + 7 days, carries a `jti`
  matching a `RefreshToken` DB row. (FR-002)

## New: `POST /auth/refresh`

Exchanges a still-valid refresh token for a new access/refresh pair
(rotation). No auth header required — the refresh token itself is the
credential.

**Request**:
```json
{ "refreshToken": "eyJhbGciOiJSUzI1NiIs..." }
```

**Response `200`**:
```json
{
  "accessToken": "eyJhbGciOiJSUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJSUzI1NiIs..."
}
```
(New refresh token — the old one is revoked as part of this call. FR-003,
single-use rotation per data-model.md.)

**Response `401`** (expired / already-used / revoked / malformed / unknown
`jti`): standard error shape already used by `HttpExceptionFilter`,
e.g. `{ "statusCode": 401, "message": "Refresh token is invalid or expired." }`.
(FR-005)

## New: `POST /auth/logout`

Requires `Authorization: Bearer <accessToken>` (goes through the existing
`JwtAuthGuard`). Revokes the caller's active refresh token(s).

**Request**: no body.

**Response `200`**:
```json
{ "loggedOut": true }
```
(FR-006)

## New: `GET /auth/.well-known/jwks.json`

Public, unauthenticated. Publishes the RSA public keys used to verify
access and refresh tokens, in standard JWKS format (RFC 7517). Access
tokens and refresh tokens are signed with **separate keypairs** (so either
can be rotated independently), so this always returns exactly two entries,
distinguished by `kid`.

**Response `200`**:
```json
{
  "keys": [
    {
      "kty": "RSA",
      "use": "sig",
      "alg": "RS256",
      "kid": "<access key id>",
      "n": "<modulus, base64url>",
      "e": "<exponent, base64url>"
    },
    {
      "kty": "RSA",
      "use": "sig",
      "alg": "RS256",
      "kid": "<refresh key id>",
      "n": "<modulus, base64url>",
      "e": "<exponent, base64url>"
    }
  ]
}
```

## Rate-limit response (applies to all endpoints, not just `/auth/*`)

**Response `429`** once a caller exceeds 50 requests in a rolling 5-minute
window:
```json
{ "statusCode": 429, "message": "Too Many Requests" }
```
with a `Retry-After` header (seconds) indicating when the window frees up
capacity, per FR-008. (`@nestjs/throttler` default behavior.)
