# Implementation Plan: Click-to-Open Date Picker & Editable Food Log

**Branch**: `007-date-picker-food-log-edit` | **Date**: 2026-08-31 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/007-date-picker-food-log-edit/spec.md`

## Summary

Two related UX fixes to the existing calorie-tracking flow: (1) make the dashboard's history date field open its native calendar dropdown on a click anywhere in the field, not only on the calendar icon; and (2) let users correct or remove a food log entry from the Food Log page (edit grams/meal, delete), and make each food item shown on the Dashboard clickable, navigating to the Food Log page scoped to the date being viewed. The backend gains a `PATCH /food/logs/:id` and `DELETE /food/logs/:id` pair mirroring the existing exercise-log edit/delete pattern; the frontend adds edit/delete controls to `FoodLog.tsx` and a click handler + `Link` on each `Dashboard.tsx` food-list item, plus a one-line behavior change to `HistoryDatePicker.tsx`.

## Technical Context

**Language/Version**: TypeScript 5 across both apps (Frontend: React 19 + Vite; Backend: Node.js + NestJS 11)

**Primary Dependencies**: Frontend — react-router-dom v7 (routing/navigation), Tailwind CSS v4, existing `apiClient` (axios) wrapper, existing UI primitives (`Card`, `Input`, `Select`, `PrimaryButton`, `SecondaryButton`). Backend — NestJS 11, Prisma ORM, `class-validator`/`class-transformer` for DTOs, existing `JwtAuthGuard` + `CurrentUser` decorator.

**Storage**: Postgres via Prisma (`Backend/prisma/schema.prisma`); no schema changes needed — `FoodLogEntry` already has all fields (`grams`, `mealCategory`, computed nutrients) required for edit. Schema changes, if any were needed, would use `prisma db push` per project convention (none needed here).

**Testing**: Backend — Jest unit tests (`*.spec.ts`, run in CI) plus Jest e2e tests (`*.e2e-spec.ts`, run locally for any backend behavior change, per project convention). Frontend — no automated test runner is configured in this repo (`Frontend/package.json` has no `test` script); verification is manual via the dev server/browser plus `npm run build`/`npm run lint`.

**Target Platform**: Web browser (Frontend deployed to Vercel, Backend to Railway)

**Project Type**: Web application — existing `Frontend/` + `Backend/` split, both already scaffolded; no new projects created.

**Performance Goals**: No special targets beyond existing app norms — interactions (open picker, click food item, save edit, delete) should feel instant (<200ms perceived), matching the rest of the app's synchronous-feeling UI.

**Constraints**: Reuse the native `<input type="date">` control already chosen in `HistoryDatePicker.tsx` (per that feature's prior research decision) — no calendar-widget library is introduced. Edit is limited to grams + meal category (changing the underlying food/source is out of scope, per spec Assumptions). Users can only edit/delete their own entries (enforced the same way exercise logs are: `findFirst({ where: { id, userId } })` before mutating).

**Scale/Scope**: Small, additive change to two existing pages/components (`Dashboard.tsx`, `FoodLog.tsx`, `HistoryDatePicker.tsx`) and one existing backend module (`food`); no new pages, no new database tables.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled placeholder template (per `CLAUDE.md`, not a ratified set of principles) — there are no project-specific principles to gate against. No violations to track; Complexity Tracking section is not needed.

## Project Structure

### Documentation (this feature)

```text
specs/007-date-picker-food-log-edit/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── food-logs-edit-delete.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
Backend/
├── src/
│   └── modules/
│       └── food/
│           ├── dto/
│           │   ├── create-food-log.dto.ts   # existing, reused for nutrient/name resolution
│           │   └── update-food-log.dto.ts   # NEW — grams?/mealCategory?
│           ├── food.controller.ts           # add PATCH /food/logs/:id, DELETE /food/logs/:id
│           └── food.service.ts              # add updateFoodLog(), deleteFoodLog()
└── test/
    └── food.e2e-spec.ts                     # existing or new — cover edit/delete happy path + ownership check

Frontend/
├── src/
│   ├── features/
│   │   └── dashboard-history/
│   │       └── HistoryDatePicker.tsx        # click-anywhere opens picker (showPicker())
│   ├── pages/
│   │   ├── Dashboard.tsx                    # food list items become clickable Links to /food-log?date=...
│   │   └── FoodLog.tsx                      # add edit/delete controls per entry; read ?date= from URL
│   └── services/
│       └── foodService.ts                   # add updateFoodLog(), deleteFoodLog()
```

**Structure Decision**: Existing `Frontend/` + `Backend/` layout is unchanged (Option 2: Web application). All changes land inside the existing `food` backend module and the existing `Dashboard`/`FoodLog`/`dashboard-history` frontend areas — no new top-level directories.

## Complexity Tracking

*No constitution violations — section not needed.*
