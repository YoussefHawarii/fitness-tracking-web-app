# Implementation Plan: Calorie & Weight Tracking Web App

**Branch**: `001-calorie-weight-tracking` | **Date**: 2026-08-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-calorie-weight-tracking/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

A three-tier web app (React SPA → NestJS REST API → PostgreSQL/Prisma) that lets a user establish a personal calorie baseline, log meals via barcode scan, voice, or manual entry, view a daily calorie balance, and see a directional weight-trend prediction compared against logged weigh-ins — all on free-tier hosting. Per updated direction, the source tree uses each framework's **standard, conventional folder structure** rather than a custom vertical-slice layout: NestJS's idiomatic `modules/` organization on the backend (one module per domain area, each holding its own controller/service/DTO), and the standard React `components/pages/hooks/services` layering on the frontend.

## Technical Context

**Language/Version**: TypeScript throughout (Node.js 20 LTS backend runtime; React 18 frontend)

**Primary Dependencies**: NestJS (backend framework), Prisma ORM, React, Tailwind CSS, `@zxing/browser` (client-side barcode decode), Web Speech API (browser-native, no library)

**Storage**: PostgreSQL, hosted on Neon (free tier, built-in PgBouncer pooler, scale-to-zero after 5 min idle)

**Testing**: Jest — unit tests scoped to the business-logic layer (BMR/TDEE, daily-balance, weight-prediction pure functions) per `docs/technical-decisions.md`; broader integration/E2E testing is out of scope for v1

**Target Platform**: Web — frontend on Netlify (static SPA), backend on Railway (usage-based free tier, does not sleep when idle)

**Project Type**: Web application (frontend + backend monorepo)

**Performance Goals**: Standard interactive web-app responsiveness for authenticated requests once warm; free-tier cold-start delay after idle is an accepted trade-off, not a target to engineer around (per `docs/architecture.md` §6)

**Constraints**: $0/month recurring hosting cost; gram-only food units (no unit conversion); all business-logic calculations (BMR/TDEE, daily balance, prediction, day-boundary math) computed server-side only, never duplicated client-side; day boundaries computed per-user local timezone with UTC storage

**Scale/Scope**: Single-user portfolio-demo scale plus occasional recruiter/reviewer traffic (per `docs/requirements-spec.md` §5) — not built for concurrent multi-tenant production load

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template (no ratified principles defined for this project). No gates are defined to check against, so this gate is treated as **N/A / pass-by-default**. No violations to justify in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/001-calorie-weight-tracking/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

Web application: existing `Backend/` and `Frontend/` folders (already scaffolded, currently empty). Per updated direction, each app follows its framework's own standard, conventional layout rather than a custom business-oriented tree.

```text
Backend/
├── src/
│   ├── modules/
│   │   ├── auth/                   # signup/login (system + Google), account linking, JWT issuance
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── auth.module.ts
│   │   │   ├── strategies/         # JWT / Google passport strategies
│   │   │   └── dto/
│   │   ├── users/                  # user profile + baseline (onboarding, BMR/TDEE)
│   │   │   ├── users.controller.ts
│   │   │   ├── users.service.ts
│   │   │   ├── users.module.ts
│   │   │   └── dto/
│   │   ├── food/                   # barcode / voice / manual entry, food log CRUD
│   │   │   ├── food.controller.ts
│   │   │   ├── food.service.ts
│   │   │   ├── food.module.ts
│   │   │   ├── clients/            # Open Food Facts client, USDA FoodData Central client
│   │   │   └── dto/
│   │   ├── calorie-balance/        # daily balance + exercise log
│   │   │   ├── calorie-balance.controller.ts
│   │   │   ├── calorie-balance.service.ts
│   │   │   ├── calorie-balance.module.ts
│   │   │   └── dto/
│   │   └── weight-prediction/      # trend prediction + weigh-ins
│   │       ├── weight-prediction.controller.ts
│   │       ├── weight-prediction.service.ts
│   │       ├── weight-prediction.module.ts
│   │       └── dto/
│   ├── common/                     # guards, interceptors, decorators, filters, pipes (cross-module)
│   ├── config/                     # env/config module
│   ├── prisma/                     # PrismaService + PrismaModule
│   ├── app.module.ts
│   └── main.ts
├── prisma/
│   └── schema.prisma
└── test/
    ├── users/
    ├── food/
    ├── calorie-balance/
    └── weight-prediction/

Frontend/
├── src/
│   ├── components/                 # shared/reusable UI building blocks (buttons, forms, chart, layout)
│   ├── pages/                      # route-level screens: Signup, Onboarding, Dashboard, FoodLog, WeightTrend
│   ├── features/                   # feature-specific UI too specific to be a shared component
│   │   ├── barcode-scanner/        # camera + @zxing/browser scan UI
│   │   └── voice-logger/           # mic capture + Web Speech API UI, transcript confirm step
│   ├── hooks/                      # custom React hooks (e.g. useAuth, useDailyBalance)
│   ├── services/                   # API client modules (one per backend module: auth, food, balance, prediction)
│   ├── context/                    # React Context providers (auth/session state)
│   ├── utils/                      # formatting, date/timezone helpers
│   ├── App.tsx
│   └── main.tsx
└── tests/                          # mirrors src/ (components, pages, features, hooks, services)
```

**Structure Decision**: Web application using the existing `Backend/` (NestJS) and `Frontend/` (React) monorepo folders, each following its own framework's standard conventions. Backend: idiomatic NestJS `modules/` structure — one module per domain area (`auth`, `users`, `food`, `calorie-balance`, `weight-prediction`), each bundling its own controller, service, DTOs, and module wiring, plus a `common/` folder for cross-cutting technical concerns (guards, interceptors) and a `prisma/` folder for the ORM client. Frontend: conventional React layering — `components/`, `pages/`, `hooks/`, `services/`, `context/`, with a `features/` folder reserved for UI too specialized to count as a shared component (the camera and microphone capture widgets).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations — Constitution Check above is N/A (unratified constitution), so this section is not applicable.
