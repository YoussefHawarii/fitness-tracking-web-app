# AGENTS.md

Guidance for AI coding agents working in this repository, regardless of which tool is reading it.

## Project overview

A fitness tracking web app: `Frontend/` (React 19 + Vite + TypeScript, Tailwind CSS v4, React Context for shared state, react-router-dom v7) talks to `Backend/` (NestJS 11 + Prisma + Postgres/Neon). Deployed separately — Frontend on Vercel (root directory `Frontend/`, framework auto-detected, no committed manifest), Backend on Railway (root directory `Backend/`, build/start commands and env vars managed in the Railway dashboard — no committed manifest).

## Backend (`Backend/`)

- Build: `npm run build` (`nest build`)
- Unit tests: `npm test` (jest, matches `*.spec.ts`) — this is what CI runs
- E2E tests: `npm run test:e2e` (jest, matches `*.e2e-spec.ts`, config at `test/jest-e2e.json`) — **not run in CI, but run these locally whenever backend behavior changes**, not just unit tests
- Lint: `npm run lint` (eslint, auto-fixes) — Format: `npm run format` (prettier)
- Prisma schema: `Backend/prisma/schema.prisma`. There is **no `migrations/` directory** — schema changes are applied with `prisma db push` + `prisma generate`, not `prisma migrate dev`. Keep using `db push` for schema changes.
- Auth: JWTs are signed with **HS256 using two symmetric secrets**, `ACCESS_TOKEN` and `REFRESH_TOKEN` (see `Backend/.env.example`, `src/modules/auth/keys.ts`). There is no RS256 keypair and no JWKS endpoint — `Backend/README.md`'s "Auth & rate limiting" section is stale and describes an old RS256/JWKS design; don't trust it for the signing algorithm.
- Refresh tokens rotate on use: `POST /auth/refresh` issues a new access/refresh pair and revokes the presented refresh token in the same call (single-use).
- Rate limiting is 50 requests / rolling 5-minute window, keyed by authenticated user or IP (`src/common/guards/user-throttler.guard.ts`, `@nestjs/throttler`).
- Required env vars: `DATABASE_URL`, `ACCESS_TOKEN`, `REFRESH_TOKEN`, `USDA_API_KEY`, `GOOGLE_CLIENT_ID`, `PORT`, `FRONTEND_ORIGIN` (CORS origin, defaults to the local Vite dev server when unset), `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (avatar uploads, `specs/008-sidebar-profile-account`) — see `Backend/.env.example`. `SUPPORT_EMAIL` is optional (falls back to `SMTP_FROM`). Note: there is no `GOOGLE_CLIENT_SECRET` — only ID-token verification is done server-side, so just the client ID is needed.
- Email/password signup requires verifying a 6-digit OTP (Nodemailer, 5-minute TTL — `src/modules/auth/auth.service.ts`, `src/modules/mail/`) before a session is issued or login is allowed; `POST /auth/verify-otp` and `POST /auth/resend-otp` handle this. See `specs/003-email-otp-verification/`.

## Frontend (`Frontend/`)

- Build: `npm run build` (`tsc -b && vite build`) — Dev server: `npm run dev`
- Lint: `npm run lint` (eslint — does *not* auto-fix). Note: `oxlint` is a devDependency with a `.oxlintrc.json` config but is **not wired into any script** — it's unused; only eslint runs.
- Format: `npm run format` (prettier)
- Env vars: `VITE_API_BASE_URL`, `VITE_GOOGLE_CLIENT_ID`

## Feature workflow (spec-kit)

New non-trivial features should follow the existing spec-kit pattern seen in `specs/001-calorie-weight-tracking/` and `specs/002-jwt-auth-rate-limit/`: write `spec.md` → `plan.md` → `tasks.md` before implementing, rather than jumping straight to code. Agents with the `speckit-specify`/`speckit-plan`/`speckit-tasks` skills should use them; without that tooling, produce the same three documents by hand, matching the structure of the existing `specs/*/` folders. Note: `.specify/memory/constitution.md` is still an unfilled placeholder template — don't treat it as a ratified set of project principles.

## Sensitive files

If a Google OAuth client-secret JSON file (`client_secret_...apps.googleusercontent.com.json`, gitignored) appears in this repo, treat it as a live credential — never print its contents or upload it anywhere.

## Further reading

- **Issue tracker**: issues live in this repo's GitHub Issues, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.
- **Domain docs**: single-context layout (`CONTEXT.md` + `docs/adr/` at repo root, created lazily). See `docs/agents/domain.md`.
