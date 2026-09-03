---

description: "Task list for Dashboard History Calendar & Time-Aware Greeting"
---

# Tasks: Dashboard History Calendar & Time-Aware Greeting

**Input**: Design documents from `/specs/006-dashboard-history-greeting/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/dashboard-history-endpoints.md](contracts/dashboard-history-endpoints.md), [quickstart.md](quickstart.md)

**Tests**: Backend unit tests are included for the two new pieces of backend logic (per plan.md's Testing strategy: `name` capture, date-query validation) since they are cheap, isolated pure/near-pure logic already covered by an existing `Backend/test/calorie-balance/` unit-test convention. No frontend automated tests are included — no frontend test runner exists in this repo (confirmed in research for spec 005 and unchanged here); frontend verification is manual via `quickstart.md`.

**Organization**: Tasks are grouped by user story (US1 = food history, US2 = exercise history, US3 = timezone-aware greeting), per spec.md's priority order.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no ordering dependency)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths are included in every description

## Path Conventions

Web app per plan.md: `Backend/src/...`, `Backend/test/...`, `Frontend/src/...`.

**Implementation note**: T001 and T009 (the `FoodLogEntry` display-name schema field and its capture logic) were found already implemented on disk at the start of implementation — using a `name String @default("")` column rather than the originally-planned nullable `foodName String?`. Docs (data-model.md, contracts/, research.md) were updated to match the actual `name` column; T001/T009 below are marked done as-is rather than redone under a different field name.

---

## Phase 1: Setup

**Purpose**: Land the one schema prerequisite everything else in this feature depends on.

- [X] T001 Add `name String @default("")` to the `FoodLogEntry` model in `Backend/prisma/schema.prisma`, then run `npx prisma db push` and `npx prisma generate` from `Backend/` (per CLAUDE.md — no `migrations/` directory in this project, schema changes use `db push`). *(Found already applied on disk; verified `npx prisma db push` reports the database already in sync.)*

**Checkpoint**: Prisma client now has a typed `name` field available to backend code.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Infrastructure every user story in this feature depends on — the account-timezone data path (needed by the calendar's day boundary in US1/US2 and by the greeting in US3) and the tightened date-query validation (needed by US1's and US2's endpoints).

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 [P] Extend `getProfile()` in `Backend/src/modules/users/users.service.ts` to also select and return the `User.timezone` field alongside the existing `UserBaseline` fields (per data-model.md's `User` section and contracts/dashboard-history-endpoints.md's `GET /profile` entry).
- [X] T003 [P] Create `Backend/src/modules/calorie-balance/dto/date-query.dto.ts` with a `date` field validated by `@IsDateString()`; apply it (replacing the bare `@Query('date') date: string`) to both `getBalance` and `listExerciseSessions` in `Backend/src/modules/calorie-balance/calorie-balance.controller.ts`, so a malformed `date` returns `400` instead of silently producing an `Invalid Date` boundary.
- [X] T004 [P] Create `Backend/src/modules/food/dto/list-food-logs-query.dto.ts` with a `date` field validated by `@IsDateString()`; apply it to `listLogsForDay` in `Backend/src/modules/food/food.controller.ts`.
- [X] T005 [P] Update `Frontend/src/services/userService.ts`: extend the profile response type with `timezone: string` so `getProfile()` returns it (mirrors T002's backend change).
- [X] T006 Create `Frontend/src/hooks/useAccountTimezone.ts`: a hook that calls `getProfile()` once, exposes the account's `timezone` string plus two helpers — `todayInAccountTimezone(): string` (returns `YYYY-MM-DD` using `Intl.DateTimeFormat` with `timeZone: timezone`, replacing `Dashboard.tsx`'s browser-clock-based `todayLocalDate()`) and `currentHourInAccountTimezone(): number` (via `Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }).format(new Date())`). Depends on T005.
- [X] T007 Create `Frontend/src/features/dashboard-history/HistoryDatePicker.tsx`: a small component wrapping a native `<input type="date" max={todayInAccountTimezone()}>` plus a "back to today" button, calling an `onDateChange(date: string)` prop (FR-001, FR-002, FR-006). Depends on T006.
- [X] T008 Wire selected-date state into `Frontend/src/pages/Dashboard.tsx`: replace the hardcoded `date = todayLocalDate()` with state derived from `todayInAccountTimezone()` (T006), render `HistoryDatePicker` (T007), and add a visible date indicator (e.g. "Showing: Today" vs "Showing: Saturday, Aug 29") per FR-005. Depends on T006, T007. *(Implemented as a derived `selectedDate = selectedDateOverride ?? todayDate` rather than an effect-seeded state, to satisfy the `react-hooks/set-state-in-effect` lint rule already enabled in `Frontend/eslint.config.js`.)*

**Checkpoint**: Foundation ready — US1, US2, and US3 can now each be implemented independently.

---

## Phase 3: User Story 1 - Browse a past day's food and calories from the Dashboard (Priority: P1) 🎯 MVP

**Goal**: Selecting a date on the Dashboard shows that day's logged food items (with readable names) and total calories consumed.

**Independent Test**: Log food on a prior day, open the Dashboard, select that date, and confirm the food list and calorie total match what was actually logged.

### Implementation for User Story 1

- [X] T009 [US1] In `Backend/src/modules/food/food.service.ts`, have `resolveNutrients` also return a `name` (from `match.name` for `USDA`, `product.name` for `OPEN_FOOD_FACTS`, `localItem.name` for `LOCAL`), and have `createFoodLog` persist it into the `name` column when creating the `FoodLogEntry` (per data-model.md, research.md's "Persist a `name` snapshot" decision).
- [X] T010 [US1] Add a unit test in `Backend/test/food/food-name-capture.spec.ts` covering all three source types (`USDA`, `OPEN_FOOD_FACTS`, `LOCAL`), asserting the created `FoodLogEntry.name` matches the source's name. Depends on T009. *(3/3 passing.)*
- [X] T011 [US1] Update `Frontend/src/services/foodService.ts`: extend `listFoodLogsForDay`'s return type with `name: string` (per contracts/dashboard-history-endpoints.md's extended `GET /food/logs` response). Depends on T009.
- [X] T012 [US1] In `Frontend/src/pages/Dashboard.tsx`, add a food-history section: call `listFoodLogsForDay(selectedDate)` whenever the selected date changes (FR-009 — replacing, not merging, prior results), render each entry (`entry.name || 'Food item'`, calories) and the day's total calories consumed (from the existing `getDailyBalance(selectedDate)` call), with its own loading state, an empty state when the list is empty (FR-007), and an error state with a retry action scoped to just this section (FR-008). Depends on T008, T011.
- [X] T013 [US1] Manually verify quickstart.md Scenario 1 (food portion), Scenario 2 (past date with no data), and Scenario 3 (future date blocked) in the browser dev server. Depends on T012. *(Verified live: seeded a past-day food entry via a temporary QA script, confirmed it renders with its real name and correct calories on that date, confirmed today's empty state, confirmed the date input's `max` blocks future dates.)*

**Checkpoint**: User Story 1 is fully functional and independently testable — food history browsing works even before US2/US3 land.

---

## Phase 4: User Story 2 - Browse a past day's exercise history from the Dashboard (Priority: P1)

**Goal**: The same selected date also shows that day's exercise sessions and total calories burned, independently of the food section's state.

**Independent Test**: Log an exercise session on a prior day, open the Dashboard, select that date, and confirm the exercise sessions and calories burned match what was actually logged.

### Implementation for User Story 2

- [X] T014 [US2] In `Frontend/src/pages/Dashboard.tsx`, add an exercise-history section reusing the same `selectedDate` state (T008): call `listExerciseSessions(selectedDate)` whenever the selected date changes, render each session (sport, duration, calories burned) and the day's total calories burned (from `getDailyBalance(selectedDate).caloriesBurnedExercise`), with its own independent loading/empty/error(+retry) states — a failure or empty result in this section must not affect the food section from US1, and vice versa (FR-004, FR-007, FR-008). Depends on T008.
- [X] T015 [US2] Manually verify quickstart.md Scenario 1 (exercise portion) and Scenario 2 (past date with no exercise data, food-only edge case) in the browser dev server. Depends on T014. *(Verified live: seeded a past-day exercise session, confirmed it renders with sport/duration/calories on that date alongside the food section.)*

**Checkpoint**: User Stories 1 and 2 both work independently and together — a selected date shows full food + exercise history.

---

## Phase 5: User Story 3 - Greeting reflects the user's own time of day (Priority: P3)

**Goal**: The Dashboard's greeting is computed from the account's timezone, not the browser's local clock.

**Independent Test**: Set a test user's account timezone to a zone whose local hour differs from the test device's system clock, load the Dashboard, and confirm the greeting matches the account timezone's hour band.

### Implementation for User Story 3

- [X] T016 [US3] In `Frontend/src/pages/Dashboard.tsx`, replace the browser-clock-based `greeting()` (using `new Date().getHours()`) with a version driven by `currentHourInAccountTimezone()` from `useAccountTimezone` (T006): `< 12` → "Good morning", `12–17` → "Good afternoon", `>= 18` → "Good evening" (FR-011, FR-012). Depends on T006.
- [X] T017 [US3] Manually verify quickstart.md Scenario 5 (greeting follows account timezone, not device clock) in the browser dev server. Depends on T016. *(Verified live: test account set to `America/Los_Angeles` (local hour ~16:00) showed "Good afternoon" while the host machine's own local time was `Africa/Cairo` ~02:00 — confirms the greeting follows the account timezone, not the device clock.)*

**Checkpoint**: All three user stories are independently functional — full feature complete.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verify the whole feature together and leave the codebase clean.

- [X] T018 [P] Run `cd Backend && npm test` (unit) and `npm run test:e2e` (per CLAUDE.md — run e2e locally whenever backend behavior changes) to confirm no regressions from T002–T004, T009. *(`npm test`: 9 suites / 52 tests passing, including the 3 new `name`-capture tests. `npm run test:e2e`: 21/24 passing — the 3 failures are in `app.e2e-spec.ts` and `auth.e2e-spec.ts` (root `/` route 404, JWKS/RS256 expectations), pre-existing and unrelated to this feature's `calorie-balance`/`food`/`users` changes; `exercise-logs.e2e-spec.ts` passed in full.)*
- [X] T019 Run the full quickstart.md validation (all 5 scenarios, end to end) after US1, US2, and US3 are all complete. Depends on T013, T015, T017. *(All 5 scenarios verified live against the dev server; see T013/T015/T017 notes plus Scenario 4 — confirmed `GET /balance`, `/exercise-logs`, `/food/logs` each return `400` for a malformed `date` via curl.)*
- [X] T020 [P] Run `npm run lint` and `npm run format` in both `Backend/` and `Frontend/`; remove `Dashboard.tsx`'s now-unused `todayLocalDate()` if fully superseded by `useAccountTimezone`. *(Both lint clean on all files this feature touched — Backend's only lint errors are 17 pre-existing, unrelated errors in `test/exercise-logs.e2e-spec.ts`. `todayLocalDate()` and the old browser-clock `greeting()` were removed as part of T008/T016's rewrite, not left dead.)*

---

## Phase 7: Follow-up — Nav label & cross-page date persistence (2026-08-31 clarification)

**Purpose**: Address post-ship feedback captured in spec.md's Clarifications (2026-08-31): the nav still says "Today" even though the Dashboard is no longer today-only (FR-014), and the selected history date is lost when navigating to another page and back (FR-013).

- [X] T021 [P] Rename the Dashboard nav item's label from `'Today'` to `'Home'` in `Frontend/src/components/AppShell.tsx` (`NAV_ITEMS`, used by both the desktop sidebar and mobile bottom nav). (FR-014)
- [X] T022 [US1] In `Frontend/src/pages/Dashboard.tsx`, persist `selectedDateOverride` to `sessionStorage` on change and read it back as the initial value on mount, so navigating away (e.g. to `/food-log`) and back within the same tab restores the same date instead of resetting to today; a new tab/fresh session has no stored value and falls back to today as before. (FR-013). Depends on T008.
- [X] T023 Manually verify: select a past date, navigate to Log Food via the nav, navigate back to the Dashboard (now labeled "Home"), and confirm the same past date is still shown. Depends on T021, T022.

**Checkpoint**: Nav reads "Home"; selected history date survives a round trip through another page within the same tab.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup (T001) for T009 later, but T002–T005 have no dependency on T001 and can start immediately in parallel with it; T006–T008 form a sequential chain within Phase 2. **Phase 2 as a whole blocks all user stories.**
- **User Stories (Phase 3–5)**: All depend on Foundational (Phase 2) completion. Independent of each other — can proceed in parallel or in priority order (US1 → US2 → US3).
- **Polish (Phase 6)**: T018/T020 can run anytime after their respective backend/frontend changes exist; T019 depends on all three stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: Depends only on Foundational. No dependency on US2 or US3.
- **User Story 2 (P1)**: Depends only on Foundational. No dependency on US1 or US3 (shares the `selectedDate` state from Foundational, not US1's code).
- **User Story 3 (P3)**: Depends only on Foundational (specifically T006). No dependency on US1 or US2.

### Parallel Opportunities

- T002, T003, T004, T005 (Foundational, different files) can run in parallel.
- Once Foundational (Phase 2) completes, US1 (Phase 3), US2 (Phase 4), and US3 (Phase 5) can be built in parallel by different people — they touch the same file (`Dashboard.tsx`) for their respective sections, so in practice sequence them or coordinate merges if working in parallel.
- T018 and T020 (Polish) can run in parallel with each other.

---

## Parallel Example: Foundational Phase

```bash
# Launch T002-T005 together (different files, no ordering dependency):
Task: "Extend getProfile() to return timezone in Backend/src/modules/users/users.service.ts"
Task: "Add date-query validation DTO in Backend/src/modules/calorie-balance/dto/date-query.dto.ts"
Task: "Add date-query validation DTO in Backend/src/modules/food/dto/list-food-logs-query.dto.ts"
Task: "Extend profile response type with timezone in Frontend/src/services/userService.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001).
2. Complete Phase 2: Foundational (T002–T008) — **critical, blocks all stories**.
3. Complete Phase 3: User Story 1 (T009–T013).
4. **STOP and VALIDATE**: Run quickstart.md Scenarios 1–3 against the food-history section only.
5. Deploy/demo if ready — food history alone already delivers the core of the original request.

### Incremental Delivery

1. Setup + Foundational → date-state and timezone infrastructure ready.
2. Add User Story 1 → food history works → validate → demo (MVP!).
3. Add User Story 2 → exercise history works alongside food → validate → demo.
4. Add User Story 3 → greeting becomes timezone-aware → validate → demo.
5. Polish (Phase 6) → full quickstart.md pass, lint/format, cleanup.

---

## Notes

- [P] tasks = different files, no ordering dependency.
- [US1]/[US2]/[US3] labels map tasks to spec.md's user stories for traceability.
- No task in this feature touches the same file across [P]-marked pairs (verified above).
- US1 and US2's `Dashboard.tsx` edits (T012, T014) are not marked [P] against each other since both edit the same file — do them sequentially even though the underlying stories are logically independent.
- Commit after each task or logical group; stop at any checkpoint to validate a story independently before continuing.
