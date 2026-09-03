# Quickstart: Validating JWT Auth & Rate Limiting

## Prerequisites

- Backend running locally: from `Backend/`, `npm install` then
  `npm run start:dev` (requires `DATABASE_URL` in `.env`; see
  `.env.example`).
- Prisma migration for `RefreshToken` applied (`npx prisma migrate dev`)
  as part of implementation — required before any of these steps work.
- A test user: sign up via `POST /auth/login` flow below, or reuse an
  existing account's credentials.

## Scenario 1 — login issues a 30-minute access token + 7-day refresh token

```bash
curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"correct-password"}'
```

**Expected**: `200` with both `accessToken` and `refreshToken` present
(contract: [contracts/auth-api.md](contracts/auth-api.md)). Decode the
`accessToken` (e.g. at jwt.io or `node -e "console.log(JSON.parse(Buffer.from(process.argv[1].split('.')[1],'base64')))" <token>`)
and confirm `exp - iat === 1800` (30 min); decode `refreshToken` and confirm
`exp - iat === 604800` (7 days). Validates FR-001, FR-002.

## Scenario 2 — silent renewal via refresh token

```bash
curl -s -X POST http://localhost:3000/auth/refresh \
  -H 'Content-Type: application/json' \
  -d "{\"refreshToken\":\"$REFRESH_TOKEN\"}"
```

**Expected**: `200` with a *new* `accessToken` and `refreshToken`, no
password required. Validates FR-003.

## Scenario 3 — reusing an already-rotated refresh token is rejected

Immediately repeat the exact Scenario 2 call with the same (now-superseded)
`$REFRESH_TOKEN`.

**Expected**: `401`. Validates FR-005 and the single-use rotation
Assumption in [data-model.md](data-model.md).

## Scenario 4 — logout invalidates the refresh token

```bash
curl -s -X POST http://localhost:3000/auth/logout \
  -H "Authorization: Bearer $ACCESS_TOKEN"

curl -s -X POST http://localhost:3000/auth/refresh \
  -H 'Content-Type: application/json' \
  -d "{\"refreshToken\":\"$REFRESH_TOKEN\"}"
```

**Expected**: logout returns `200`; the subsequent refresh attempt with the
now-revoked token returns `401`. Validates FR-006.

## Scenario 5 — expired access token is rejected on protected routes

Use a deliberately expired/garbage bearer token against any
`@UseGuards(JwtAuthGuard)` route (e.g. `GET` on a `users` endpoint):

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/users/me \
  -H 'Authorization: Bearer not-a-real-token'
```

**Expected**: `401`. Validates FR-004.

## Scenario 6 — rate limit trips after 50 requests in 5 minutes

```bash
for i in $(seq 1 51); do
  curl -s -o /dev/null -w '%{http_code} ' http://localhost:3000/users/me \
    -H "Authorization: Bearer $ACCESS_TOKEN"
done; echo
```

**Expected**: the first 50 responses are `200`/`401` (whatever the route
normally returns) and the 51st is `429` with a `Retry-After` header.
Validates FR-007, FR-008, FR-010.

## Scenario 7 — JWKS endpoint is publicly reachable

```bash
curl -s http://localhost:3000/auth/.well-known/jwks.json
```

**Expected**: `200` with a `{"keys":[...]}` body containing **two** RSA
public keys (`kty: "RSA"`), one for access tokens and one for refresh
tokens, each with a distinct `kid`. Validates the JWT/JWK constraint from
the spec input and Decision 1–2 in [research.md](research.md).
