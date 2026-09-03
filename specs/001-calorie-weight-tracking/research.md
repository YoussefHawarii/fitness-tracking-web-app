# Phase 0 Research: Calorie & Weight Tracking Web App

All technology and architecture decisions for this feature were already settled in the project's approved documentation (`docs/requirements-spec.md`, `docs/business-logic.md`, `docs/architecture.md`, `docs/technical-decisions.md`) before this planning phase began. There are no remaining `NEEDS CLARIFICATION` markers in the Technical Context. This document consolidates those prior decisions in the Decision/Rationale/Alternatives format for traceability, plus one new structural decision made during this planning phase (source-tree organization).

## Decision: Backend framework — NestJS

- **Rationale**: Structured, batteries-included Node.js framework; matches existing team skillset; REST support is first-class.
- **Alternatives considered**: Express (rejected — too little structure for a portfolio project meant to demonstrate architecture); GraphQL/Apollo (rejected — this app's data is flat/non-nested, so GraphQL's main advantage over REST, avoiding nested over-fetching, doesn't apply).

## Decision: API style — REST

- **Rationale**: Data shapes in this domain (food logs, weigh-ins, baselines) are flat, not deeply nested — REST suits this better than GraphQL.
- **Alternatives considered**: GraphQL (rejected per above, despite prior team experience with it).

## Decision: ORM — Prisma, Database — PostgreSQL on Neon

- **Rationale**: Enforces foreign-key/referential integrity at the database level (a stated non-functional requirement); Neon's free tier includes a pooler (PgBouncer) supporting far more connections than Prisma's default pool needs, at $0/month.
- **Alternatives considered**: None recorded — this was a settled prior decision, not re-evaluated here.
- **Known trade-off accepted**: Neon compute scales to zero after 5 minutes idle — the Railway backend itself does not idle-sleep, so this cold-start risk is isolated to the database layer; first request after inactivity can still be slow. Accepted per `docs/architecture.md` §6; not something this plan attempts to engineer around.

## Decision: Frontend framework — React, styling — Tailwind CSS

- **Rationale**: Existing skillset; Tailwind keeps styling co-located and fast to iterate on for a solo-built portfolio app.
- **Alternatives considered**: Angular (spec allowed either; React chosen); Redux for state (explicitly rejected — too much ceremony for this app's scope; React Context or Zustand preferred as a lighter-weight fit).

## Decision: Barcode scanning — `@zxing/browser` (zxing-js)

- **Rationale**: Deliberately chosen over the simpler `html5-qrcode` for more manual control over the camera stream/decode loop — taken on specifically for the resume/learning value of demonstrating direct camera-hardware integration.
- **Alternatives considered**: `html5-qrcode` (rejected — plug-and-play, less demonstrable control over the decode loop).

## Decision: Voice input — Web Speech API (browser-native)

- **Rationale**: Free, no backend audio handling or storage required; transcription happens entirely client-side.
- **Alternatives considered**: Self-hosted Whisper model — reserved as a fallback only if Egyptian Arabic (`ar-EG`) transcription accuracy proves too poor in manual testing; trade-off is it needs real backend CPU, in tension with the $0-hosting constraint. Not adopted unless/until that test result requires it (see `spec.md` Assumptions).

## Decision: Auth — JWT sessions, two providers (system email/password + Google OAuth), merge-by-verified-email linking

- **Rationale**: Keeps the auth surface simple (only two providers); linking by email avoids duplicate accounts for the same person.
- **Alternatives considered**: Blocking/flagging instead of merging on conflict (rejected as the primary behavior — merge is the stated rule) — but merging is gated on email verification specifically to close the account-squatting risk identified in `docs/architecture.md` §3.

## Decision: Testing — Jest, scoped to business-logic unit tests only for v1

- **Rationale**: The highest-value, highest-risk code is the pure-function business logic (BMR/TDEE, balance, prediction) — a silent formula error there (like the double-counting risk already caught in `docs/business-logic.md` §2) is the failure mode most worth guarding against. Broader integration/E2E suites are explicitly deferred past v1.
- **Alternatives considered**: Full integration/E2E coverage (rejected for v1 — scope/time trade-off for a portfolio project).

## Decision: Hosting — Vercel (frontend) + Railway (backend) + Neon (database), monorepo with `/Backend` and `/Frontend`

- **Rationale**: All three have workable free tiers, hitting the $0/month requirement.
- **Alternatives considered**: None recorded as seriously evaluated; this was a settled prior decision.
- **Deployment note carried forward**: Vercel and Railway must each be configured to build/deploy only their respective subfolder, not the whole monorepo — flagged in `docs/technical-decisions.md` as a common first-time misconfiguration to test early.

## Decision: Source-tree organization — standard framework conventions (revised decision)

- **Rationale**: An earlier iteration of this plan used a custom "screaming architecture" (root folders named for business use cases, e.g. `onboarding/`, `food-logging/`). That was explicitly reverted at the requester's request in favor of each framework's own standard, familiar layout: NestJS's idiomatic `modules/` structure (one module per domain area, each bundling its own controller/service/DTO) on the backend, and the conventional React `components/pages/hooks/services` layering on the frontend. Familiarity and low cognitive overhead for anyone opening the repo were prioritized over a custom structure.
- **Alternatives considered**: The custom screaming/vertical-slice architecture from the prior plan iteration (rejected — reverted per explicit request); a purely technical-layer split with no per-domain module grouping at all (rejected — NestJS's own module system already provides natural per-domain grouping, so discarding it would fight the framework rather than use it as intended).
