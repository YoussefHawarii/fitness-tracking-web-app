---

description: "Task list template for feature implementation"
---

# Tasks: Click-to-Open Date Picker & Editable Food Log

**Input**: Design documents from `/specs/007-date-picker-food-log-edit/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/food-logs-edit-delete.md](contracts/food-logs-edit-delete.md), [quickstart.md](quickstart.md)

**Tests**: Backend tests are included — `CLAUDE.md` requires e2e tests to be run locally for any backend behavior change, and this feature adds two new backend routes. Frontend has no automated test runner configured in this repo, so frontend verification tasks are manual (against `quickstart.md`) rather than automated.

**Organization**: Tasks are grouped by user story (from [spec.md](spec.md)) to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Every task includes an exact file path

## Path Conventions

Existing web app layout: `Backend/src/...`, `Backend/test/...`, `Frontend/src/...` (no new top-level directories — see plan.md's Project Structure).

---

## Phase 1: Setup

**Purpose**: Confirm the existing dev environment is ready — no new dependencies, scaffolding, or config are introduced by this feature.

- [X] T001 Verify local dev environment: `Backend/.env` is configured per `Backend/.env.example` and `npm run start:dev` (from `Backend/`) starts cleanly; `npm run dev` (from `Frontend/`) starts and successfully calls the running backend. No code changes — verification only, unblocks manual testing for every story below.

---

## Phase 2: Foundational

**Purpose**: Blocking prerequisites shared by multiple user stories.

None. Each story below builds on existing, unmodified infrastructure (`JwtAuthGuard`, `CurrentUser` decorator, `FoodService.resolveNutrients()`/`calculateNutrientsForGrams()`, `apiClient`) with no shared new groundwork to lay first. Proceed directly to the user story phases.

---

## Phase 3: User Story 1 - One-click date picker (Priority: P1) 🎯 MVP

**Goal**: Clicking anywhere in the dashboard's date field opens the native calendar dropdown, instead of requiring a click on the small calendar icon or manual typing.

**Independent Test**: Open the Dashboard, click anywhere in the date field's box (not just the calendar glyph), and confirm the calendar dropdown opens immediately and picking a date updates the dashboard.

### Implementation for User Story 1

- [X] T002 [US1] In `Frontend/src/features/dashboard-history/HistoryDatePicker.tsx`, add an `onClick` handler on the `<input type="date">` that calls `event.currentTarget.showPicker()`, feature-detected via `'showPicker' in HTMLInputElement.prototype` and wrapped so a thrown/unsupported call silently falls through to the input's default click behavior (per `research.md` §1). Keep the existing `max`, `onChange`, and "Back to today" button behavior unchanged.
- [X] T003 [US1] Manually verify per `quickstart.md` Story 1: click-anywhere opens the dropdown, a past-date selection updates the Dashboard and shows "Back to today", future dates remain blocked, and Tab + Enter/Space still opens the picker via keyboard.

**Checkpoint**: User Story 1 is fully functional and independently testable.

---

## Phase 4: User Story 3 - Edit and delete logged food entries (Priority: P1)

**Goal**: Each food log entry on the Food Log page gets edit (grams, meal category) and delete controls, with server-side recomputation of nutrients and ownership enforcement.

**Independent Test**: Log a food item, edit its gram amount and confirm calories recompute, then delete an entry and confirm it disappears from the list; confirm invalid edits are rejected and a second delete attempt shows a graceful "already removed" message.

### Backend for User Story 3

- [X] T004 [P] [US3] Create `Backend/src/modules/food/dto/update-food-log.dto.ts` with an `UpdateFoodLogDto` class: optional `grams` (`@IsNumber()`, `@IsPositive()`) and optional `mealCategory` (`@IsEnum(MealCategory)`), mirroring `Backend/src/modules/calorie-balance/dto/update-exercise-log.dto.ts`'s structure.
- [X] T005 [US3] Add `updateFoodLog(userId: string, id: string, dto: UpdateFoodLogDto)` to `Backend/src/modules/food/food.service.ts`: `findFirst({ where: { id, userId } })` and throw `NotFoundException` if missing; merge `dto.grams`/`dto.mealCategory` onto the existing entry; call the existing private `resolveNutrients(userId, existing.sourceType, existing.sourceRef)` and `calculateNutrientsForGrams()` to recompute `caloriesComputed`/`proteinComputed`/`carbsComputed`/`fatComputed` for the (possibly new) grams; persist via `prisma.foodLogEntry.update()` (depends on T004).
- [X] T006 [US3] Add `deleteFoodLog(userId: string, id: string)` to `Backend/src/modules/food/food.service.ts`: `findFirst({ where: { id, userId } })` and throw `NotFoundException` if missing, otherwise `prisma.foodLogEntry.delete({ where: { id } })` — mirrors `CalorieBalanceService.deleteExercise`.
- [X] T007 [US3] Add `PATCH('logs/:id')` route to `Backend/src/modules/food/food.controller.ts` (guarded by the controller's existing `JwtAuthGuard`) taking `@Param('id')` and `@Body() dto: UpdateFoodLogDto`, calling `foodService.updateFoodLog(user.userId, id, dto)` (depends on T005).
- [X] T008 [US3] Add `DELETE('logs/:id')` route to `Backend/src/modules/food/food.controller.ts` with `@HttpCode(HttpStatus.NO_CONTENT)`, calling `foodService.deleteFoodLog(user.userId, id)` (depends on T006).
- [X] T009 [P] [US3] Add/extend `Backend/test/food.e2e-spec.ts` covering: `PATCH /food/logs/:id` happy path (grams change recomputes calories proportionally), `PATCH` validation failure (`grams` ≤ 0 → 400), `PATCH`/`DELETE` on another user's entry → 404, `DELETE /food/logs/:id` happy path → 204, and a second `DELETE` on the same id → 404 — per `contracts/food-logs-edit-delete.md`.
- [X] T010 [P] [US3] Add/extend a unit test file for `FoodService` (e.g. `Backend/src/modules/food/food.service.spec.ts`) covering `updateFoodLog`'s recompute logic and ownership check, and `deleteFoodLog`'s ownership check, with the Prisma client mocked.

### Frontend for User Story 3

- [X] T011 [P] [US3] Add `updateFoodLog(id, input)` and `deleteFoodLog(id)` functions to `Frontend/src/services/foodService.ts` (`PATCH /food/logs/:id`, `DELETE /food/logs/:id`) per `contracts/food-logs-edit-delete.md`.
- [X] T012 [US3] In `Frontend/src/pages/FoodLog.tsx`, add an edit control and a delete control to each rendered entry row: edit opens an inline form (grams input + meal `Select`, reusing `FieldLabel`/`Input`/`Select`/`PrimaryButton`/`SecondaryButton`) with Save/Cancel, calling `updateFoodLog` on Save and refreshing entries (`refreshEntries()`) on success; delete asks for confirmation (e.g. `window.confirm`) then calls `deleteFoodLog` and refreshes entries; a 404 response from either call is caught and shown via the existing `status` message state as an "already removed — refreshing" notice before calling `refreshEntries()` (depends on T011).
- [X] T013 [US3] In the same edit form from T012, validate the grams input is a positive number before calling `updateFoodLog`, showing an inline error and leaving the entry untouched when invalid — matches FR-008 (part of T012's file, sequential).
- [X] T014 [US3] Manually verify per `quickstart.md` Story 3: edit grams (e.g. 100→200) recomputes and roughly doubles displayed calories; invalid grams (0/negative/blank) is rejected with the original entry unchanged; Cancel leaves the entry unchanged; delete removes the entry from the list; a repeated delete attempt on the same entry shows a graceful message instead of a raw error.

**Checkpoint**: User Stories 1 AND 3 both work independently.

---

## Phase 5: User Story 2 - Home page food entries link to Food Log (Priority: P2)

**Goal**: The Dashboard's food list stays in sync with the Food Log page's data (already true today) and each food item is clickable, navigating to the Food Log page scoped to the same date.

**Independent Test**: Log a food item, confirm it shows on the Dashboard with matching name/calories, click it, and confirm the app navigates to the Food Log page showing that same entry for that same date (including a past date selected via the Story 1 date picker).

### Implementation for User Story 2

- [X] T015 [US2] In `Frontend/src/pages/FoodLog.tsx`, read a `date` query param via `useSearchParams` (from `react-router-dom`), defaulting to `todayLocalDate()` when absent; use this resolved date (instead of the hardcoded `todayLocalDate()` call) as the `refreshEntries`/`listFoodLogsForDay` argument and as a `refreshEntries` dependency, per `research.md` §4.
- [X] T016 [US2] In `Frontend/src/pages/Dashboard.tsx`, wrap each food-list item (inside the "Food logged" `<ul>`) in a `Link` (or make the existing `<li>` clickable) to `` `/food-log?date=${selectedDate}` ``, preserving the current row's visual styling; depends on T015 so the destination page honors the date (depends on T015).
- [X] T017 [US2] Manually verify per `quickstart.md` Story 2: the Dashboard's food list matches the Food Log page's entries for today; clicking an item navigates to the Food Log page for today's date; after viewing a past date via the Story 1 date picker with logged food, clicking one of those items navigates to the Food Log page scoped to that same past date (not today).

**Checkpoint**: All three user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final regression checks across all three stories.

- [X] T018 [P] Run `npm run lint` and `npm run build` from `Frontend/` to confirm no type or lint regressions from T002, T011–T013, T015–T016.
- [X] T019 [P] Run `npm run lint`, `npm test`, and `npm run test:e2e` from `Backend/` to confirm no regressions and that the new tests (T009, T010) pass — per `CLAUDE.md`, e2e tests are not run in CI but must be run locally for any backend behavior change.
- [X] T020 Run the full `quickstart.md` validation end-to-end (Stories 1, 3, then 2 in that order) against the running dev servers from T001.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Empty — no blocking prerequisites exist for this feature.
- **User Stories (Phase 3–5)**: All can start once Phase 1 is done.
  - **US1** (Phase 3): No dependency on US2 or US3 — fully independent.
  - **US3** (Phase 4): No dependency on US1 or US2 — fully independent.
  - **US2** (Phase 5): Functionally independent (navigation works with or without edit/delete existing), but **implementation should follow US3** because both touch `Frontend/src/pages/FoodLog.tsx` — doing US3's edit/delete UI first avoids rework when US2 adds date-param support to the same file.
- **Polish (Phase 6)**: Depends on whichever of US1/US2/US3 are completed.

### Recommended Execution Order

1. Phase 1 (Setup)
2. Phase 3 (US1) and Phase 4 (US3) — both P1, independent of each other, can be done in either order or in parallel by different developers
3. Phase 5 (US2) — after US3, to avoid rework in `FoodLog.tsx`
4. Phase 6 (Polish)

### Within User Story 3

`T004` (DTO) → `T005`/`T006` (service methods, same file — sequential with each other) → `T007`/`T008` (controller routes, same file — sequential with each other, each depending on its matching service method) → `T009`/`T010` (tests, parallel with each other and with T011) → `T011` (frontend service functions) → `T012` (UI, depends on T011) → `T013` (validation, same file as T012) → `T014` (manual verification, last).

### Within User Story 2

`T015` (date param) → `T016` (Dashboard link, depends on T015) → `T017` (manual verification, last).

### Parallel Opportunities

- T004 (backend DTO) can be written in parallel with T011 (frontend service functions) — different files, different apps.
- T009 and T010 (backend tests) can run in parallel with each other once T005–T008 are done.
- T018 and T019 (Polish) can run in parallel — different apps.
- US1 (Phase 3) can be implemented in parallel with US3 (Phase 4) by different developers, since they touch entirely separate files.

---

## Parallel Example: User Story 3

```bash
# Once T004 (DTO) is done, backend service work is sequential (same file):
Task: "Implement updateFoodLog in Backend/src/modules/food/food.service.ts"
Task: "Implement deleteFoodLog in Backend/src/modules/food/food.service.ts"

# After the routes exist, tests can run in parallel with frontend work:
Task: "Add e2e tests in Backend/test/food.e2e-spec.ts"
Task: "Add unit tests in Backend/src/modules/food/food.service.spec.ts"
Task: "Add updateFoodLog/deleteFoodLog to Frontend/src/services/foodService.ts"
```

---

## Implementation Strategy

### MVP First (Both P1 Stories)

1. Complete Phase 1: Setup.
2. Complete Phase 3: User Story 1 (one-click date picker) — small, low-risk, immediately shippable on its own.
3. Complete Phase 4: User Story 3 (edit/delete food entries) — the core new capability requested.
4. **STOP and VALIDATE**: run `quickstart.md` Stories 1 and 3 independently.
5. This pair (US1 + US3) is the MVP — both are P1 and deliver the two concrete pain points named first in the request.

### Incremental Delivery

1. Setup → Phase 3 (US1) → validate → ship.
2. Phase 4 (US3) → validate → ship.
3. Phase 5 (US2, builds on US3's `FoodLog.tsx` changes) → validate → ship.
4. Phase 6 (Polish) → final regression pass.

### Independent Test Criteria Recap

- **US1**: Click anywhere in the date field → calendar dropdown opens → picking a date updates the Dashboard.
- **US3**: Edit an entry's grams → calories recompute; delete an entry → it's gone; invalid edit is rejected; repeat delete is handled gracefully.
- **US2**: Dashboard food list matches Food Log data; clicking an item navigates to the Food Log page for the correct (possibly past) date.
