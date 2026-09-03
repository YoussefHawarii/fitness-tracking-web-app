# Fitness Tracking Web App

A calorie, macro, exercise, and weight tracking web app. Users log meals (via barcode scan, voice, or manual entry), track workouts, and follow a predicted-vs-actual weight trend based on their computed BMR/TDEE.

## Stack

- **Frontend** (`Frontend/`) — React 19 + Vite + TypeScript, Tailwind CSS v4, Zustand, react-router-dom v7
- **Backend** (`Backend/`) — NestJS 11 + Prisma + PostgreSQL (Neon)
- **External APIs** — Open Food Facts (barcode lookup), USDA FoodData Central (food name lookup), Web Speech API (client-side voice input), Cloudinary (avatar uploads)

This is a monorepo, but Frontend and Backend deploy independently:
- **Frontend** → Vercel (root directory set to `Frontend/` in the Vercel dashboard; framework auto-detected, no committed manifest)
- **Backend** → Railway (root directory set to `Backend/` in the Railway dashboard; build/deploy config is managed there, not via a committed manifest)
- **Database** → Neon (Postgres)

See `docs/architecture.md` for the full system design and `docs/business-logic.md` for the calorie/TDEE/prediction formulas.

## Getting started

### Prerequisites
- Node.js 20+
- A Postgres database (e.g. a free [Neon](https://neon.tech) project)
- API keys: [USDA FoodData Central](https://fdc.nal.usda.gov/api-key-signup), Google OAuth client credentials, SMTP credentials (e.g. a Gmail App Password), Cloudinary credentials

### Backend setup

```bash
cd Backend
npm install
cp .env.example .env   # fill in DATABASE_URL, ACCESS_TOKEN, REFRESH_TOKEN, USDA_API_KEY, etc.
npx prisma db push     # applies the schema — this project uses `prisma db push`, not migrations
npx prisma generate
npm run start:dev      # http://localhost:3000
```

### Frontend setup

```bash
cd Frontend
npm install
cp .env.example .env   # set VITE_API_BASE_URL and VITE_GOOGLE_CLIENT_ID
npm run dev             # http://localhost:5173
```

## Scripts

| | Backend | Frontend |
|---|---|---|
| Dev server | `npm run start:dev` | `npm run dev` |
| Build | `npm run build` | `npm run build` |
| Unit tests | `npm test` | — |
| E2E tests | `npm run test:e2e` | — |
| Lint | `npm run lint` (auto-fixes) | `npm run lint` (no auto-fix) |
| Format | `npm run format` | `npm run format` |

Backend unit tests (`npm test`) run in CI on every PR (`.github/workflows/ci.yml`). Backend E2E tests are not run in CI — run them locally whenever backend behavior changes.

## Project structure

```
Backend/            NestJS API — see Backend/README.md
Frontend/           React SPA — see Frontend/README.md
docs/                Architecture, business logic, and requirements docs
specs/               Per-feature specs (spec-kit workflow: spec.md → plan.md → tasks.md)
```

## Environment variables

Real secrets are never committed — see each package's `.env.example` for the full list of required variables (`Backend/.env.example`, `Frontend/.env.example`).

## Auth

JWTs are signed with HS256 using two symmetric secrets (`ACCESS_TOKEN`, `REFRESH_TOKEN`). Email/password signup requires verifying a 6-digit OTP sent by email before a session is issued. Google OAuth is also supported. Refresh tokens rotate on use (single-use, revoked on refresh).
