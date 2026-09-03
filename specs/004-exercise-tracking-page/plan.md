# Implementation Plan: Exercise Tracking Page

**Branch**: `004-exercise-tracking-page` | **Date**: 2026-08-30 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/004-exercise-tracking-page/spec.md`

## Summary

Replace the dashboard's free-text "calories burned" quick-entry form with a dedicated Exercise page. Users pick a sport (Football, Swimming, Padel, Basketball, Gym/Weight Training, Running, Tennis, or "Other" with a typed name) and a duration; calories are calculated server-side from a MET-based formula using the sport's intensity, the user's baseline body weight, and the entered duration. Sessions are listed for the current day, editable and deletable in place. The dashboard's existing "Exercise" total continues to read from the same data, unchanged in how it feeds (or rather, doesn't feed) the expended/balance calculation.

## Technical Context

**Language/Version**: TypeScript throughout (Backend: Node.js on NestJS 11; Frontend: React 19)

**Primary Dependencies**: NestJS 11, Prisma ORM, class-validator/class-transformer (Backend); React 19 + Vite, react-router-dom v7, Tailwind CSS v4 (Frontend)

**Storage**: PostgreSQL (Neon) — existing database, extending the existing `exercise_log_entries` table via `prisma db push` (no migrations directory in this project)

**Testing**: Jest for Backend unit tests (`*.spec.ts`) and e2e tests (`*.e2e-spec.ts`, run locally per CLAUDE.md); no Frontend test runner is configured in this repo — Frontend verification is manual/browser-based (per CLAUDE.md's UI verification guidance) plus `tsc -b` and `eslint`

**Target Platform**: Web — Frontend on Netlify, Backend on Railway

**Project Type**: Web application (existing `Frontend/` + `Backend/` split)

**Performance Goals**: No new performance requirements beyond existing app norms — calorie calculation is a synchronous in-memory formula (no external API calls), so response time is dominated by the existing DB round-trip pattern already used by other CRUD endpoints in this app

**Constraints**: Must preserve the existing rule that exercise calories are excluded from `caloriesExpended`/balance (docs/business-logic.md §2) — this feature only changes how exercise entries are captured and managed, not how they feed the balance calculation. Must require a baseline (`UserBaseline.currentWeightKg`) to exist before logging, since the calorie formula needs body weight.

**Scale/Scope**: One Prisma model extended with 2 new columns (sport type, duration), 3 new/changed API endpoints (create already exists and gets extended; add PATCH and DELETE), one new Frontend page, one fixed 8-entry sport/MET reference table in backend code, removal of the old dashboard quick-entry form.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is an unfilled placeholder template (per CLAUDE.md) — there are no ratified project principles to gate against. No violations to evaluate; this section is a pass-through.

## Project Structure

### Documentation (this feature)

```text
specs/004-exercise-tracking-page/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md         # Phase 1 output (/speckit-plan command)
├── contracts/            # Phase 1 output (/speckit-plan command)
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
Backend/
├── prisma/schema.prisma                                  # extend ExerciseLogEntry model
└── src/modules/calorie-balance/
    ├── calorie-balance.controller.ts                      # extend: PATCH/DELETE /exercise-logs/:id
    ├── calorie-balance.service.ts                          # extend: update/delete/list, ownership checks
    ├── exercise-met-table.ts                               # NEW: fixed sport → MET value reference table
    ├── dto/
    │   ├── create-exercise-log.dto.ts                       # replace caloriesBurned input with sportType/duration/customSportName
    │   └── update-exercise-log.dto.ts                       # NEW
    └── (existing balance-calculator.ts, day-boundary.util.ts unchanged)

Backend/test/
├── calorie-balance/exercise-met-table.spec.ts               # NEW unit tests
└── exercise-logs.e2e-spec.ts                                 # NEW e2e: create/edit/delete/ownership

Frontend/src/
├── pages/
│   ├── Exercise.tsx                                          # NEW dedicated page
│   └── Dashboard.tsx                                         # remove ExerciseLogForm usage, link to /exercise
├── components/
│   ├── ExerciseLogForm.tsx                                    # removed (replaced by Exercise page form)
│   └── ExerciseSessionCard.tsx                                 # NEW: list item w/ inline edit + delete
└── services/
    └── calorieBalanceService.ts                              # extend: listExerciseSessions, updateExercise, deleteExercise, sport catalog type
```

**Structure Decision**: This is the existing Frontend/ + Backend/ web application split (Option 2 from the template). No new services, apps, or directories are introduced — the feature extends the existing `calorie-balance` backend module (which already owns exercise logging) and adds one new Frontend page alongside the existing `pages/` directory, consistent with how `WeightTrend.tsx` and `FoodLog.tsx` are already structured as sibling top-level pages under `AppShell`.

## Complexity Tracking

*No constitution violations — this section is not applicable.*
