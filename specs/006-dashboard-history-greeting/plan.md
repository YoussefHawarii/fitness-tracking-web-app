# Implementation Plan: Dashboard History Calendar & Time-Aware Greeting

**Branch**: `006-dashboard-history-greeting` | **Date**: 2026-08-31 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/006-dashboard-history-greeting/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Add a native date picker to `Dashboard.tsx` so users can select any date up to today and see that day's food log (items + total calories) and exercise log (sessions + total calories burned), reusing three already-working, date-parameterized backend endpoints (`GET /balance`, `GET /exercise-logs`, `GET /food/logs`) that today are only ever called with "today". Two small backend gaps block a fully correct implementation and are closed as part of this feature: (1) `FoodLogEntry` has no human-readable name, so a food history list would show opaque source IDs — fixed by persisting a `name` snapshot at log-creation time; (2) the account's IANA `timezone` (already stored on `User` and already used server-side for day-boundary math) is never returned by any endpoint the frontend can read — fixed by including it in `GET /profile`'s response, so the frontend can compute both the calendar's day boundary and the greeting from the account's timezone instead of the browser's local clock. The greeting itself is not new logic (`Dashboard.tsx` already computes "Good morning/afternoon/evening" from an hour) — only its hour source changes.

## Technical Context

**Language/Version**: TypeScript 5 (React 19) for `Frontend/`; TypeScript (Node) NestJS 11 for `Backend/`

**Primary Dependencies**: Frontend — existing `Frontend/src/services/{calorieBalanceService,foodService}.ts`, native HTML5 `<input type="date">` (no new npm dependency). Backend — existing Prisma `FoodLogEntry`/`User` models, `class-validator` (already a NestJS dependency) for new query-param validation.

**Storage**: PostgreSQL via Prisma — one additive schema change: `FoodLogEntry.name String @default("")`, applied with `prisma db push` + `prisma generate` (per CLAUDE.md, no `migrations/` directory in this project).

**Testing**: Backend — new/extended `*.spec.ts` for the `name` capture logic and the new date-query validation, run via `npm test`; run `npm run test:e2e` locally afterward since backend behavior changes (per CLAUDE.md). Frontend — manual browser verification via the dev server (no frontend test runner is wired into `Frontend/package.json`, consistent with prior specs).

**Target Platform**: Web browser (existing Vite/React frontend) talking to the existing NestJS backend.

**Project Type**: Web application (`Frontend/` + `Backend/`, per CLAUDE.md) — this feature touches both: a small backend data/contract change plus a frontend-only UI addition.

**Performance Goals**: Selecting a date and rendering that day's data in under 2 seconds under normal network conditions (SC-002), matching the existing latency of the endpoints being reused (no new computation added beyond one extra field being selected/returned).

**Constraints**: Must not change any existing successful response shape's *existing* fields (only additive fields); must not regress the existing "today" dashboard view or any other consumer of `GET /profile`, `GET /balance`, `GET /exercise-logs`, `GET /food/logs`; calendar must not allow future-date selection (FR-002); date-range/day-boundary math must stay driven by the account's stored timezone, consistent with existing `day-boundary.util.ts` usage (FR-010).

**Scale/Scope**: One page (`Frontend/src/pages/Dashboard.tsx`) plus one new small frontend component (date picker + history sections); two backend modules touched (`food`, `users`) with additive-only changes; one Prisma schema field addition. No new pages, routes, or backend modules.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is an unfilled placeholder template (confirmed in CLAUDE.md) — it defines no ratified principles or gates to check against. This gate is treated as **N/A / pass by default**.

**Post-Phase 1 re-check**: No change. Phase 1 design (data-model.md, contracts/, quickstart.md) confirmed all backend changes are additive (new column with a default, new response field, tightened query validation) with no breaking changes to any existing contract — still N/A / pass.

## Project Structure

### Documentation (this feature)

```text
specs/006-dashboard-history-greeting/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
Backend/
└── src/modules/
    ├── food/
    │   ├── food.service.ts                 # MODIFY: capture a display name into `name` when
    │   │                                    #   creating a FoodLogEntry (from the USDA match's `name`,
    │   │                                    #   the OFF product's name, or the LocalFoodItem's `name`)
    │   ├── food.controller.ts               # MODIFY: validate `date` query param on GET /food/logs
    │   └── dto/
    │       └── list-food-logs-query.dto.ts  # NEW: small DTO with @IsDateString() for `date`
    ├── calorie-balance/
    │   ├── calorie-balance.controller.ts    # MODIFY: validate `date` query param on both GET routes
    │   └── dto/
    │       └── date-query.dto.ts            # NEW: shared date-query DTO reused by both routes
    └── users/
        └── users.service.ts                 # MODIFY: getProfile() also selects and returns `timezone`

Backend/prisma/
└── schema.prisma                            # MODIFY: add `name String @default("")` to FoodLogEntry

Frontend/
└── src/
    ├── pages/
    │   └── Dashboard.tsx                    # MODIFY: add selected-date state, calendar control, "back to
    │                                        #   today" action, per-section loading/error/empty states,
    │                                        #   date-indicator, and timezone-aware greeting
    ├── features/
    │   └── dashboard-history/                # NEW: small feature folder (matches existing
    │       └── HistoryDatePicker.tsx         #   barcode-scanner/voice-logger one-feature-per-folder
    │                                        #   convention), wraps the native <input type="date">
    │                                        #   plus the "jump to today" affordance
    └── services/
        ├── calorieBalanceService.ts         # MODIFY: no shape change, still date-parameterized
        ├── foodService.ts                   # MODIFY: `listFoodLogsForDay` return type gains `name`
        └── userService.ts                   # MODIFY: profile response type gains `timezone`
```

**Structure Decision**: Web application per CLAUDE.md (`Frontend/` + `Backend/`, deployed separately). Backend work is deliberately minimal and additive (one new column with a default, one extended response field, tightened validation on three existing routes) rather than new endpoints — all three read endpoints the Dashboard needs already exist and are already date-parameterized. Frontend work is scoped to `Dashboard.tsx` plus one new small component under `Frontend/src/features/dashboard-history/`, following the same one-feature-per-folder convention already used for `barcode-scanner/` and `voice-logger/` (per spec 005's structure decision).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations — Constitution Check is N/A (placeholder constitution, no gates defined). The two backend changes beyond a pure frontend feature (the `name` snapshot column and the `timezone` profile field) are the minimum needed to make the spec's requirements (readable food history, account-timezone-driven greeting/day-boundary) actually correct rather than a UI-only reuse of endpoints that would otherwise show opaque IDs or the wrong greeting.
