---

description: "Task list for Exercise Tracking Page feature implementation"
---

# Tasks: Exercise Tracking Page

**Input**: Design documents from `specs/004-exercise-tracking-page/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/exercise-logs-api.md](contracts/exercise-logs-api.md), [quickstart.md](quickstart.md)

**Tests**: Included — this project's established convention (see CLAUDE.md, and every prior feature in this repo) is Backend unit tests (Jest, CI-run) plus Backend e2e tests (Jest, run locally per behavior change). Frontend has no test runner configured; Frontend verification is `tsc -b` + `eslint` + manual browser validation against `quickstart.md`.

**Organization**: Tasks are grouped by user story (from spec.md, in priority order) to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)

## Path Conventions

Existing Frontend/ + Backend/ web app split (see plan.md's Project Structure). All paths below are relative to the repository root (`D:\fitness tracking web app\`).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Schema and reference-data groundwork needed before any endpoint or UI work.

- [X] T001 [P] Update `Backend/prisma/schema.prisma`: add a `SportType` enum (`FOOTBALL, SWIMMING, PADEL, BASKETBALL, GYM_WEIGHTS, RUNNING, TENNIS, OTHER`) and add `sportType SportType`, `customSportName String?`, `durationMinutes Int` columns to the `ExerciseLogEntry` model per [data-model.md](data-model.md); then run `npx prisma db push` and `npx prisma generate` from `Backend/` (stop any running dev server first to avoid the Windows file-lock issue on the generated client, per prior session notes)
- [X] T002 [P] Create `Backend/src/modules/calorie-balance/exercise-met-table.ts` exporting a `MET_TABLE: Record<SportType, number>` constant (values from [research.md](research.md) "Decision: MET value table") and a `SPORT_CATALOG` array of `{ sportType, label }` entries (values from [contracts/exercise-logs-api.md](contracts/exercise-logs-api.md) `GET /sports` response) for reuse by both the service and controller

**Checkpoint**: Schema migrated, reference data available.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared DTOs and the calorie calculator every user story's backend work depends on.

**⚠️ CRITICAL**: No user story backend work can begin until this phase is complete.

- [X] T003 [P] Rewrite `Backend/src/modules/calorie-balance/dto/create-exercise-log.dto.ts` to accept `sportType` (enum, required), `customSportName` (string, required only when `sportType = OTHER`), `durationMinutes` (int, 1–1440), `date` (ISO date string) — remove the old `caloriesBurned` client input field entirely, per [contracts/exercise-logs-api.md](contracts/exercise-logs-api.md) (depends on T001)
- [X] T004 [P] Create `Backend/src/modules/calorie-balance/dto/update-exercise-log.dto.ts`: same fields as the create DTO minus `date`, all optional but at least one required, per the `PATCH /exercise-logs/:id` contract (depends on T001)
- [X] T005 [P] Create `Backend/src/modules/calorie-balance/exercise-calorie-calculator.ts` exporting a function computing `calories = MET(sportType) × weightKg × (durationMinutes / 60)`, rounded to a whole number, using `MET_TABLE` from T002 (depends on T002)
- [X] T006 Create `Backend/test/calorie-balance/exercise-calorie-calculator.spec.ts` with unit tests for the calculator: correct value for a known sport/duration/weight combination, `OTHER` uses the general default MET, rounding behavior (depends on T005)

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - Log an exercise session by sport and duration (Priority: P1) 🎯 MVP

**Goal**: A user can open the Exercise page, pick a sport (or type one via "Other"), enter a duration, and get an automatically calculated, saved calorie value.

**Independent Test**: Open the Exercise page, select a sport, enter a duration, save, and confirm a new entry appears with a plausible calculated calorie value — per [quickstart.md](quickstart.md) Scenarios 1, 2, 3, 4.

### Implementation for User Story 1

- [X] T007 [US1] Update `Backend/src/modules/calorie-balance/calorie-balance.service.ts`: rewrite `logExercise` to (a) reject if the user has no `UserBaseline` row (400, per FR-005), (b) validate `customSportName` is present when `sportType = OTHER`, (c) compute `caloriesBurned` via the T005 calculator using `baseline.currentWeightKg`, (d) persist `sportType`/`customSportName`/`durationMinutes` alongside the computed value; add a `getSportCatalog()` method returning `SPORT_CATALOG` from T002 (depends on T003, T005, T002)
- [X] T008 [US1] Update `Backend/src/modules/calorie-balance/calorie-balance.controller.ts`: update `POST /exercise-logs` to use the new DTO/service signature; add `GET /sports` returning `getSportCatalog()`, per [contracts/exercise-logs-api.md](contracts/exercise-logs-api.md) (depends on T007)
- [X] T009 [P] [US1] Create `Backend/test/exercise-logs.e2e-spec.ts` covering `POST /exercise-logs`: valid create for each sport type, "Other" with a typed name, rejection of duration 0 and duration > 1440, rejection when no baseline exists (400), and `GET /sports` returning the fixed catalog (depends on T008)
- [X] T010 [P] [US1] Update `Frontend/src/services/calorieBalanceService.ts`: add a `SportType` union type, an `ExerciseSession` interface (id, sportType, customSportName, durationMinutes, caloriesBurned, loggedForDate), `getSportCatalog()`, and `createExerciseSession(input)` replacing the old `logExercise(caloriesBurned, date)` signature
- [X] T011 [US1] Create `Frontend/src/pages/Exercise.tsx`: a form with a sport picker (the 7 named sports + "Other"), a free-text input shown only when "Other" is selected, a duration input (minutes), and a submit action calling `createExerciseSession` (depends on T010)
- [X] T012 [US1] Add a protected `/exercise` route in `Frontend/src/App.tsx` (same `AppPage`/`ProtectedRoute` wrapper pattern used by `/food-log` and `/weight-trend`) rendering the new `Exercise` page (depends on T011)
- [X] T013 [US1] Update `Frontend/src/pages/Dashboard.tsx`: remove the `<ExerciseLogForm date={date} onLogged={refresh} />` usage and replace it with a link/button into `/exercise` (depends on T012)
- [X] T014 [US1] Delete `Frontend/src/components/ExerciseLogForm.tsx` (no longer referenced anywhere) (depends on T013)

**Checkpoint**: User Story 1 is fully functional and independently testable — a user can log a sport-based exercise session end to end.

---

## Phase 4: User Story 2 - Edit a previously logged exercise entry (Priority: P1)

**Goal**: A user can correct a mistaken entry's sport and/or duration in place, with calories recalculating automatically.

**Independent Test**: Create an exercise entry, edit its duration and/or sport, save, and confirm the same entry updates (no duplicate) with recalculated calories — per [quickstart.md](quickstart.md) Scenario 5.

### Implementation for User Story 2

- [X] T015 [US2] Add an `updateExercise(userId, id, dto)` method to `Backend/src/modules/calorie-balance/calorie-balance.service.ts`: look up the entry scoped to `{ id, userId }` (404 if no match, per FR-008), merge the provided fields, recompute `caloriesBurned` via the T005 calculator when `sportType`/`customSportName`/`durationMinutes` change (depends on T004, T005, T007)
- [X] T016 [US2] Add `PATCH /exercise-logs/:id` to `Backend/src/modules/calorie-balance/calorie-balance.controller.ts` calling `updateExercise` (depends on T015)
- [X] T017 [P] [US2] Extend `Backend/test/exercise-logs.e2e-spec.ts` with `PATCH /exercise-logs/:id` tests: duration-only edit recalculates calories, sport-change edit recalculates using the new MET, and editing another user's entry returns 404 (depends on T016)
- [X] T018 [P] [US2] Add `updateExerciseSession(id, input)` to `Frontend/src/services/calorieBalanceService.ts`
- [X] T019 [US2] Create `Frontend/src/components/ExerciseSessionCard.tsx`: displays one session (sport/custom name, duration, calories) with an inline edit mode (sport picker + duration input) that calls `updateExerciseSession` on save (depends on T018)

**Checkpoint**: User Stories 1 and 2 both work independently — sessions can be logged and corrected.

---

## Phase 5: User Story 3 - Delete a logged exercise entry (Priority: P2)

**Goal**: A user can permanently remove a mistaken or duplicate exercise entry.

**Independent Test**: Create an exercise entry, delete it, and confirm it no longer appears and no longer contributes to the day's total — per [quickstart.md](quickstart.md) Scenario 6.

### Implementation for User Story 3

- [X] T020 [US3] Add a `deleteExercise(userId, id)` method to `Backend/src/modules/calorie-balance/calorie-balance.service.ts`: delete scoped to `{ id, userId }` (404 if no match, per FR-008) (depends on T007)
- [X] T021 [US3] Add `DELETE /exercise-logs/:id` to `Backend/src/modules/calorie-balance/calorie-balance.controller.ts` returning 204, calling `deleteExercise` (depends on T020)
- [X] T022 [P] [US3] Extend `Backend/test/exercise-logs.e2e-spec.ts` with `DELETE /exercise-logs/:id` tests: successful delete removes the entry, deleting another user's entry returns 404 (depends on T021)
- [X] T023 [P] [US3] Add `deleteExerciseSession(id)` to `Frontend/src/services/calorieBalanceService.ts`
- [X] T024 [US3] Add a delete action with a confirmation step to `Frontend/src/components/ExerciseSessionCard.tsx`, calling `deleteExerciseSession` (depends on T023, T019)

**Checkpoint**: User Stories 1, 2, and 3 all work independently — sessions can be logged, corrected, and removed.

---

## Phase 6: User Story 4 - View the day's logged sessions and running total (Priority: P2)

**Goal**: A user sees every session logged today, individually, plus the day's total exercise calories, consistent between the Exercise page and the Dashboard.

**Independent Test**: Log two or more sessions in a day and confirm the Exercise page lists each individually and its total matches the Dashboard's existing "Exercise" figure — per [quickstart.md](quickstart.md) Scenarios 7, 8.

### Implementation for User Story 4

- [X] T025 [US4] Add a `listExerciseSessions(userId, date)` method to `Backend/src/modules/calorie-balance/calorie-balance.service.ts`, scoped to the user and local date (reusing the existing day-boundary convention already used by `getDailyBalance`), ordered most-recent-first (depends on T007)
- [X] T026 [US4] Add `GET /exercise-logs?date=` to `Backend/src/modules/calorie-balance/calorie-balance.controller.ts` calling `listExerciseSessions`, per [contracts/exercise-logs-api.md](contracts/exercise-logs-api.md) (depends on T025)
- [X] T027 [P] [US4] Extend `Backend/test/exercise-logs.e2e-spec.ts` with `GET /exercise-logs` tests: returns today's sessions most-recent-first, returns an empty array when none logged, only returns the requesting user's own sessions (depends on T026)
- [X] T028 [P] [US4] Add `listExerciseSessions(date)` to `Frontend/src/services/calorieBalanceService.ts`
- [X] T029 [US4] Update `Frontend/src/pages/Exercise.tsx` to fetch and render today's sessions via `ExerciseSessionCard` (edit/delete already wired), show the day's total, and show an empty state when there are no sessions yet (depends on T028, T011, T019, T024)

**Checkpoint**: All four user stories are independently functional. The Dashboard's existing "Exercise" tile (reads from `GET /balance`, unchanged) now reflects sport-based entries automatically — no Dashboard change needed beyond T013's link.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation and full-suite verification once all stories are complete.

- [X] T030 [P] Update `docs/business-logic.md` to add a note (near §2/§4) documenting that exercise calories are now calculated from sport type + duration + baseline weight via a MET-based formula (per [research.md](research.md)), rather than entered directly — the existing rule that exercise stays excluded from `caloriesExpended`/balance (§2) is unchanged
- [X] T031 Run the Backend unit suite (`npm test` in `Backend/`) and the e2e suite (`npm run test:e2e` in `Backend/`); confirm all pass, including the new tests from T006, T009, T017, T022, T027
- [X] T032 Run `npx tsc -b` and `npm run lint` in `Frontend/`; confirm both are clean
- [X] T033 Manually execute all 8 scenarios in [quickstart.md](quickstart.md) in the browser and confirm each behaves as described, including Dashboard/Exercise-page total consistency (Scenario 7) and that `caloriesExpended`/balance stay unaffected by exercise logging (Scenario 7, step 4)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup (T001, T002) — blocks all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational completion. No dependency on other stories — this is the MVP.
- **User Story 2 (Phase 4)**: Depends on Foundational completion (specifically T007, since `updateExercise` reuses the same calculation path established there). Independently testable once T007 exists, but naturally follows US1 since US1 delivers the entries there are to edit.
- **User Story 3 (Phase 5)**: Depends on Foundational + T007 (same reasoning as US2). Independent of US2's code paths.
- **User Story 4 (Phase 6)**: Depends on Foundational + T007. Its Frontend task (T029) also depends on the `ExerciseSessionCard` component built in US2/US3 (T019, T024), since listing reuses that component for edit/delete affordances.
- **Polish (Phase 7)**: Depends on all four user stories being complete.

### Within Each User Story

- Backend service methods before backend controller routes before backend e2e tests before frontend service functions before frontend UI.
- Story complete before its checkpoint is considered met.

### Parallel Opportunities

- T001 and T002 (Setup) can run in parallel.
- T003, T004, T005 (Foundational) can run in parallel — different files, no cross-dependency.
- Within each user story phase, the `[P]`-marked e2e test task and the `[P]`-marked frontend service task can run in parallel with each other (different files), but both depend on their phase's backend controller task being complete first.

---

## Parallel Example: Foundational Phase

```bash
Task: "Rewrite create-exercise-log.dto.ts in Backend/src/modules/calorie-balance/dto/create-exercise-log.dto.ts"
Task: "Create update-exercise-log.dto.ts in Backend/src/modules/calorie-balance/dto/update-exercise-log.dto.ts"
Task: "Create exercise-calorie-calculator.ts in Backend/src/modules/calorie-balance/exercise-calorie-calculator.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: run [quickstart.md](quickstart.md) Scenarios 1–4 manually
5. This alone already replaces the confusing free-text calorie field with sport-based logging — a real, demoable improvement even before edit/delete/list exist.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. User Story 1 → validate → this is the MVP (sport-based logging works, old form is gone).
3. User Story 2 → validate → mistakes are correctable in place.
4. User Story 3 → validate → mistakes are removable.
5. User Story 4 → validate → full day view, dashboard consistency confirmed.
6. Polish → docs + full verification pass.

## Notes

- `[P]` tasks touch different files and have no unmet dependency at the point they're listed.
- Every backend service/controller change reuses this project's existing conventions: `userId` always derived from `@CurrentUser()`, ownership enforced via scoped Prisma queries (`{ id, userId }`), `prisma db push` (no migrations directory) for schema changes.
- Commit after each task or logical group, consistent with how prior features in this repo were built.
