---

description: "Task list template for feature implementation"
---

# Tasks: Calorie & Weight Tracking Web App

**Input**: Design documents from `/specs/001-calorie-weight-tracking/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: Unit tests are included, scoped to the business-logic pure functions only (BMR/TDEE, calorie calculation, daily balance, weight prediction), per the explicit decision in `docs/technical-decisions.md` ("Testing" section) and `plan.md` Technical Context. Broader integration/contract/E2E test suites are explicitly out of scope for v1 and are not generated here.

**Organization**: Tasks are grouped by user story (from `spec.md`) to enable independent implementation and testing of each story.

**Note on migrations**: ~~This sandbox has no live Postgres/Neon instance~~ — **update**: a real Neon project ("Fitness App", `little-resonance-81589429`) is now connected via MCP. The full schema (6 tables, 4 enums, all foreign keys) was applied directly against it and verified: `npx prisma db pull` round-trips to the same schema, the backend boots and connects successfully ("Nest application successfully started"), and a live signup request wrote and was read back from the real `users` table (then cleaned up). `Backend/.env`'s `DATABASE_URL` now points at this real database. `Backend/prisma/migrations/` has no migration history yet since the schema was applied as raw SQL rather than via `prisma migrate dev` — run `npx prisma migrate resolve --applied <name>` or a fresh `prisma migrate dev` baseline next time you evolve the schema, so future changes go through Prisma's normal migration history instead of ad hoc SQL.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)
- Paths follow `plan.md`'s standard-framework structure: `Backend/src/modules/<name>/...` (NestJS) and `Frontend/src/...` (React)

## Path Conventions

- **Backend**: `Backend/src/modules/<name>/`, `Backend/src/common/`, `Backend/src/config/`, `Backend/src/prisma/`, `Backend/prisma/schema.prisma`, `Backend/test/`
- **Frontend**: `Frontend/src/pages/`, `Frontend/src/features/`, `Frontend/src/services/`, `Frontend/src/context/`, `Frontend/src/components/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic tooling

- [X] T001 Initialize NestJS backend project in `Backend/` (package.json, tsconfig.json, nest-cli.json)
- [X] T002 [P] Initialize React + Vite frontend project in `Frontend/` (package.json, tsconfig.json, vite.config.ts)
- [X] T003 [P] Configure ESLint + Prettier for the backend in `Backend/.eslintrc.js`
- [X] T004 [P] Configure ESLint + Prettier for the frontend in `Frontend/.eslintrc.js`
- [X] T005 [P] Configure Tailwind CSS in `Frontend/tailwind.config.js` and `Frontend/src/index.css`
- [X] T006 Install and configure Prisma CLI in `Backend/` (`prisma init`, `DATABASE_URL` wired to a Neon Postgres connection string)
- [X] T007 [P] Configure Jest for business-logic unit testing in `Backend/jest.config.js`
- [X] T008 [P] Create environment config module (`DATABASE_URL`, `JWT_SECRET`, `USDA_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) in `Backend/src/config/config.module.ts`
- [X] T009 Create a GitHub Actions workflow that runs the Jest suite on every pull request in `.github/workflows/ci.yml`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T010 Define the base `User` model (id, email, emailVerified, passwordHash, googleSubjectId, timezone, createdAt per `data-model.md`) in `Backend/prisma/schema.prisma` and run the initial migration
- [X] T011 [P] Implement `PrismaService` and `PrismaModule` in `Backend/src/prisma/prisma.service.ts` and `Backend/src/prisma/prisma.module.ts`
- [X] T012 [P] Implement JWT strategy and auth-guard scaffolding (no business logic yet) in `Backend/src/modules/auth/strategies/jwt.strategy.ts` and `Backend/src/common/guards/jwt-auth.guard.ts`
- [X] T013 [P] Implement a global validation pipe and HTTP exception filter in `Backend/src/common/pipes/validation.pipe.ts` and `Backend/src/common/filters/http-exception.filter.ts`
- [X] T014 Wire `AppModule` to load `ConfigModule`, `PrismaModule`, and register the global pipe/filter in `Backend/src/app.module.ts` (depends on T008, T011, T013)
- [X] T015 [P] Implement the frontend API client wrapper (base URL, attaches JWT) in `Frontend/src/services/apiClient.ts`
- [X] T016 [P] Implement the frontend auth context/provider (holds session/JWT state) in `Frontend/src/context/AuthContext.tsx`
- [X] T017 [P] Implement the frontend routing shell with a protected-route wrapper in `Frontend/src/App.tsx`

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Create Account and Establish Personal Baseline (Priority: P1) 🎯 MVP

**Goal**: A new user can sign up (system email/password or Google), complete onboarding, and receive a computed BMR/TDEE baseline that recalculates on profile updates; same/verified-email accounts merge instead of duplicating.

**Independent Test**: Complete signup with valid onboarding data and verify a baseline is computed and stored; update weight/height/age and verify recalculation; sign up via system then via Google with the same verified email and verify a single merged account.

### Tests for User Story 1

- [X] T018 [P] [US1] Unit test for the BMR/TDEE calculator (Mifflin-St Jeor, both sexes, non-exercise activity multiplier per `docs/business-logic.md` §1) in `Backend/test/users/baseline-calculator.spec.ts`

### Implementation for User Story 1

- [X] T019 [P] [US1] Add the `UserBaseline` model (per `data-model.md`) to `Backend/prisma/schema.prisma` and run the migration
- [X] T020 [P] [US1] Implement password hashing and credential validation in `Backend/src/modules/auth/auth.service.ts`
- [X] T021 [US1] Implement `AuthService.signup` and `AuthService.login` (system email/password) in `Backend/src/modules/auth/auth.service.ts` (depends on T020)
- [X] T022 [US1] Implement Google OAuth token verification and the verified-email account-linking/merge rule (FR-007, FR-008) in `Backend/src/modules/auth/auth.service.ts` (depends on T021)
- [X] T023 [US1] Implement `AuthController` endpoints (`POST /auth/signup`, `POST /auth/login`, `POST /auth/google`, `POST /auth/verify-email`) in `Backend/src/modules/auth/auth.controller.ts` (depends on T022)
- [X] T024 [P] [US1] Implement the BMR/TDEE calculator as a pure function in `Backend/src/modules/users/baseline-calculator.ts` (covered by T018)
- [X] T025 [US1] Implement `UsersService` (create baseline on onboarding, recalculate on profile update via T024) in `Backend/src/modules/users/users.service.ts` (depends on T019, T024)
- [X] T026 [US1] Implement `UsersController` endpoints (`POST /onboarding`, `GET /profile`, `PATCH /profile`) in `Backend/src/modules/users/users.controller.ts` (depends on T025)
- [X] T027 [US1] Register `AuthModule` and `UsersModule` in `Backend/src/app.module.ts` (depends on T023, T026)
- [X] T028 [P] [US1] Build signup and login pages (system form + Google button) in `Frontend/src/pages/Signup.tsx` and `Frontend/src/pages/Login.tsx`
- [X] T029 [P] [US1] Build the onboarding form page (age, sex, height, weight, goal weight, activity level) in `Frontend/src/pages/Onboarding.tsx`
- [X] T030 [US1] Implement the frontend auth API service (signup/login/google/verify calls) in `Frontend/src/services/authService.ts` (depends on T028)
- [X] T031 [US1] Implement the frontend profile/baseline API service and profile page display in `Frontend/src/services/userService.ts` and `Frontend/src/pages/Profile.tsx` (depends on T029)

**Checkpoint**: User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Log Meals via Barcode, Voice, or Manual Entry (Priority: P2)

**Goal**: A user can log a food item via barcode scan (Open Food Facts), voice (USDA FoodData Central, with mandatory transcript confirmation and candidate selection), or manual entry (private, type-validated), converging on a gram-based calorie calculation and a required meal category.

**Independent Test**: Log one food item through each of the three input paths and confirm each produces a correctly calculated, saved log entry tagged with a meal category.

### Tests for User Story 2

- [X] T032 [P] [US2] Unit test for the gram-based calorie/macro calculation formula `(nutrient per 100g ÷ 100) × grams` (per `docs/business-logic.md` §4) in `Backend/test/food/calorie-calculator.spec.ts`

### Implementation for User Story 2

- [X] T033 [P] [US2] Add `LocalFoodItem` and `FoodLogEntry` models (per `data-model.md`) to `Backend/prisma/schema.prisma` and run the migration
- [X] T034 [P] [US2] Implement the Open Food Facts client — barcode lookup that checks the response body's status field, not just the HTTP status (FR-010) — in `Backend/src/modules/food/clients/open-food-facts.client.ts`
- [X] T035 [P] [US2] Implement the USDA FoodData Central client (term search, returns candidate matches) in `Backend/src/modules/food/clients/usda.client.ts`
- [X] T036 [P] [US2] Implement the calorie/macro calculator as a pure function in `Backend/src/modules/food/calorie-calculator.ts` (covered by T032)
- [X] T037 [US2] Implement `FoodService` (barcode-lookup routing, USDA search routing, local-item CRUD with type validation, log-entry creation using T036) in `Backend/src/modules/food/food.service.ts` (depends on T033, T034, T035, T036)
- [X] T038 [US2] Implement `FoodController` endpoints (`GET /food/barcode/:code`, `GET /food/search-usda`, `POST/GET /food/local-items`, `POST/GET /food/logs`) in `Backend/src/modules/food/food.controller.ts` (depends on T037)
- [X] T039 [US2] Register `FoodModule` in `Backend/src/app.module.ts` (depends on T038)
- [X] T040 [P] [US2] Build the barcode-scanner UI (camera + `@zxing/browser` decode loop) in `Frontend/src/features/barcode-scanner/BarcodeScanner.tsx`
- [X] T041 [P] [US2] Build the voice-logger UI (mic capture + Web Speech API, mandatory transcript edit/confirm step, candidate-match picker) in `Frontend/src/features/voice-logger/VoiceLogger.tsx`
- [X] T042 [P] [US2] Build the manual-entry form and food-log form (meal-category select, grams input) in `Frontend/src/pages/FoodLog.tsx`
- [X] T043 [US2] Implement the frontend food API service (barcode/search/local-items/logs calls) in `Frontend/src/services/foodService.ts` (depends on T040, T041, T042)

**Checkpoint**: User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - View Daily Calorie Balance and Optionally Log Exercise (Priority: P3)

**Goal**: A user can view calories consumed vs. expended (baseline TDEE plus optional logged exercise burn, defaulting to zero) and the resulting daily balance, computed on midnight-to-midnight boundaries in the user's local timezone.

**Independent Test**: Log food for a day (baseline already established) and verify the displayed daily balance, with and without an exercise entry, calculates correctly; verify day-boundary grouping uses local timezone.

### Tests for User Story 3

- [X] T044 [P] [US3] Unit test for the daily-balance calculation (consumed − expended, exercise defaults to zero, per `docs/business-logic.md` §2) in `Backend/test/calorie-balance/balance-calculator.spec.ts`
- [X] T045 [P] [US3] Unit test for timezone-aware day-boundary grouping (per `docs/business-logic.md` §7) in `Backend/test/calorie-balance/day-boundary.spec.ts`

### Implementation for User Story 3

- [X] T046 [P] [US3] Add the `ExerciseLogEntry` model (per `data-model.md`) to `Backend/prisma/schema.prisma` and run the migration
- [X] T047 [P] [US3] Implement the timezone-aware day-boundary helper as a pure function in `Backend/src/modules/calorie-balance/day-boundary.util.ts` (covered by T045)
- [X] T048 [P] [US3] Implement the daily-balance calculator as a pure function in `Backend/src/modules/calorie-balance/balance-calculator.ts` (covered by T044)
- [X] T049 [US3] Implement `CalorieBalanceService` (exercise-log CRUD, daily-balance aggregation using food logs + baseline + T047/T048) in `Backend/src/modules/calorie-balance/calorie-balance.service.ts` (depends on T046, T047, T048)
- [X] T050 [US3] Implement `CalorieBalanceController` endpoints (`POST /exercise-logs`, `GET /balance`) in `Backend/src/modules/calorie-balance/calorie-balance.controller.ts` (depends on T049)
- [X] T051 [US3] Register `CalorieBalanceModule` in `Backend/src/app.module.ts` (depends on T050)
- [X] T052 [P] [US3] Build the daily dashboard/summary UI (consumed, expended, balance) in `Frontend/src/pages/Dashboard.tsx`
- [X] T053 [P] [US3] Build the exercise-log entry form (optional per-day input) in `Frontend/src/components/ExerciseLogForm.tsx`
- [X] T054 [US3] Implement the frontend calorie-balance API service (exercise-log and balance calls) in `Frontend/src/services/calorieBalanceService.ts` (depends on T052, T053)

**Checkpoint**: User Stories 1, 2, AND 3 should all work independently

---

## Phase 6: User Story 4 - View Predicted Weight Trend and Compare Against Actual Weigh-ins (Priority: P4)

**Goal**: A user can view a directional, non-clinical 1–2 week predicted weight change from cumulative daily balances, and log actual weigh-ins to see predicted-vs-actual with a delta.

**Independent Test**: Generate several days of daily balances, verify a predicted weight change is produced over the 1–2 week window, and log a weigh-in to confirm predicted-vs-actual is displayed.

### Tests for User Story 4

- [X] T055 [P] [US4] Unit test for the weight-prediction formula (cumulative balance ÷ 7700 kcal/kg, per `docs/business-logic.md` §3) in `Backend/test/weight-prediction/prediction-calculator.spec.ts`
- [X] T056 [P] [US4] Unit test for the predicted-vs-actual delta calculation and the insufficient-data state in `Backend/test/weight-prediction/comparison-calculator.spec.ts`

### Implementation for User Story 4

- [X] T057 [P] [US4] Add the `WeighIn` model (per `data-model.md`) to `Backend/prisma/schema.prisma` and run the migration
- [X] T058 [P] [US4] Implement the weight-prediction calculator as a pure function in `Backend/src/modules/weight-prediction/prediction-calculator.ts` (covered by T055, T056)
- [X] T059 [US4] Implement `WeightPredictionService` (weigh-in CRUD, prediction over a 1–2 week window, predicted-vs-actual comparison, explicit insufficient-data state per FR-022/FR-023) in `Backend/src/modules/weight-prediction/weight-prediction.service.ts` (depends on T057, T058)
- [X] T060 [US4] Implement `WeightPredictionController` endpoints (`POST/GET /weigh-ins`, `GET /prediction`) in `Backend/src/modules/weight-prediction/weight-prediction.controller.ts` (depends on T059)
- [X] T061 [US4] Register `WeightPredictionModule` in `Backend/src/app.module.ts` (depends on T060)
- [X] T062 [P] [US4] Build the weight-trend chart (predicted vs. actual) and weigh-in log form in `Frontend/src/pages/WeightTrend.tsx`
- [X] T063 [US4] Implement the frontend weight-prediction API service in `Frontend/src/services/weightPredictionService.ts` (depends on T062)

**Checkpoint**: All four user stories should now be independently functional

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T064 [P] Run all `quickstart.md` validation scenarios end-to-end and record results — **partially done**: frontend routing/auth-guard/console-clean smoke-tested in-browser; backend now confirmed live against a real Neon DB (signup wrote and was read back from the real `users` table, JWT guard verified). Still blocked on a Google OAuth client and a USDA API key for the remaining scenarios (voice logging, USDA search, Google sign-in)
- [X] T065 [P] Add consistent loading/error states across `Frontend/src/pages/*`
- [ ] T066 Configure Netlify and Render to build/deploy only their respective subfolder (`Frontend/`, `Backend/`) — `netlify.toml` and `Backend/render.yaml` — and do a test deploy per `docs/technical-decisions.md` — **config files created**; the actual test deploy requires live Netlify/Render accounts, not available here
- [X] T067 [P] Review CORS and security headers on the backend in `Backend/src/main.ts`
- [ ] T068 Confirm the deployed stack incurs no recurring cost at single-user demo scale (SC-007) — requires an actual deployment to verify; not performed in this sandbox

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-6)**: All depend on Foundational phase completion
  - Can proceed in priority order (P1 → P2 → P3 → P4) for incremental delivery
  - US2, US3, and US4 each read data produced by earlier stories (food logs, baseline) but expose their own independently testable slice
- **Polish (Phase 7)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - no dependency on other stories. Required first in practice because US2–US4 all need an authenticated user and baseline to be meaningful.
- **User Story 2 (P2)**: Can start after Foundational - independently testable on its own, but a realistic demo needs US1's auth/session first.
- **User Story 3 (P3)**: Reads food logs (US2) and baseline (US1) to compute a balance; independently testable once those exist.
- **User Story 4 (P4)**: Reads daily balances (US3) to compute a prediction; independently testable once those exist.

### Within Each User Story

- Unit tests (where included) before the pure-function implementation they cover
- Prisma model additions before service implementation
- Service implementation before controller/endpoint implementation
- Backend endpoints before the frontend service that calls them
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel (T002-T008)
- All Foundational tasks marked [P] can run in parallel (T011-T013, T015-T017)
- Within each user story, unit tests and independent pure-function/model tasks marked [P] can run in parallel
- Frontend UI tasks marked [P] within a story can run in parallel with backend tasks in the same story, since they land in different files

---

## Parallel Example: User Story 1

```bash
# Launch the unit test and independent pieces for User Story 1 together:
Task: "Unit test for the BMR/TDEE calculator in Backend/test/users/baseline-calculator.spec.ts"
Task: "Add the UserBaseline model to Backend/prisma/schema.prisma"
Task: "Implement password hashing and credential validation in Backend/src/modules/auth/auth.service.ts"
Task: "Implement the BMR/TDEE calculator as a pure function in Backend/src/modules/users/baseline-calculator.ts"
Task: "Build signup and login pages in Frontend/src/pages/Signup.tsx and Frontend/src/pages/Login.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test signup, onboarding, baseline calculation, and account linking independently
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo (food logging live)
4. Add User Story 3 → Test independently → Deploy/Demo (daily balance live)
5. Add User Story 4 → Test independently → Deploy/Demo (weight prediction live)
6. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (auth/onboarding)
   - Developer B: User Story 2 (food logging) — can build against a stubbed baseline until US1 lands
   - Developer C: User Story 3 (calorie balance) — can build against stubbed food logs until US2 lands
3. Stories complete and integrate as their real dependencies land

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify unit tests fail before implementing the function they cover
- Commit after each task or logical group
- Stop at any checkpoint to validate a story independently
- Avoid: vague tasks, same-file conflicts, cross-story dependencies that break independence
