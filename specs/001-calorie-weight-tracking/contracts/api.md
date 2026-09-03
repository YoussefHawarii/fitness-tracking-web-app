# Phase 1 Interface Contracts: REST API

High-level endpoint contracts the backend exposes to the frontend, grouped by the NestJS module that owns them (matches `Backend/src/modules/<name>/*.controller.ts` in `plan.md`). This documents shape and behavior, not a full OpenAPI spec — exact route/DTO naming is an implementation detail for `/speckit-tasks`.

## `auth` module

| Endpoint | Method | Request | Response | Notes |
|---|---|---|---|---|
| `/auth/signup` | POST | email, password | JWT + user id | System signup path (FR-001) |
| `/auth/login` | POST | email, password | JWT | |
| `/auth/google` | POST | Google OAuth token | JWT + user id | Merges into existing verified-email account if one exists (FR-007, FR-008) |
| `/auth/verify-email` | POST | verification token | success/failure | Required before a system account is merge-eligible |

## `users` module (onboarding + profile/baseline)

| Endpoint | Method | Request | Response | Notes |
|---|---|---|---|---|
| `/onboarding` | POST | age, sex, heightCm, currentWeightKg, goalWeightKg, activityLevel, timezone | computed baseline (bmr, tdee) | FR-002 through FR-005 |
| `/profile` | GET | — | current profile + baseline | |
| `/profile` | PATCH | any of age/heightCm/currentWeightKg/goalWeightKg/activityLevel | recalculated baseline | Triggers FR-006 |

## `food` module

| Endpoint | Method | Request | Response | Notes |
|---|---|---|---|---|
| `/food/barcode/{code}` | GET | barcode value | matched product (per-100g nutrients) or not-found | Applies OFF body-status check, not just HTTP status (FR-010) |
| `/food/search-usda` | GET | food term(s) | candidate matches (per-100g nutrients each) | User picks one client-side (FR-013); no auto-select |
| `/food/local-items` | POST | name, caloriesPer100g, macros? | created LocalFoodItem | Type-validated (FR-015), private to user (FR-016) |
| `/food/local-items` | GET | — | this user's LocalFoodItems | |
| `/food/logs` | POST | sourceType, sourceRef, grams, mealCategory, loggedAt | created FoodLogEntry with computed calories/macros | FR-017, FR-018 |
| `/food/logs?date=` | GET | date | that day's FoodLogEntries, grouped by mealCategory | Day boundary per FR-021 |

## `calorie-balance` module

| Endpoint | Method | Request | Response | Notes |
|---|---|---|---|---|
| `/exercise-logs` | POST | caloriesBurned, date | created ExerciseLogEntry | Optional per day (FR-019) |
| `/balance?date=` | GET | date | consumed, expended (tdee + exercise), balance | FR-020, day boundary per user timezone (FR-021) |

## `weight-prediction` module

| Endpoint | Method | Request | Response | Notes |
|---|---|---|---|---|
| `/weigh-ins` | POST | weightKg, date | created WeighIn | No fixed cadence (FR-024) |
| `/weigh-ins` | GET | — | all logged weigh-ins, each with predicted-vs-actual delta where a prediction exists for that date | FR-025 |
| `/prediction?window=` | GET | window (1–2 weeks) | predicted weight change, predicted weight, explicit "directional estimate" label | FR-022, FR-023; returns an explicit "insufficient data" state rather than a number when not enough days are logged |

## Cross-cutting contract notes

- All endpoints above (except `/auth/*`) require a valid JWT (issued by the `auth` module); enforcement lives in a shared `common/` guard, not duplicated per module.
- All calculated fields in every response (baseline, calories, balance, prediction) are computed server-side; the frontend never independently derives them (per Technical Context constraint carried from `docs/architecture.md` §2).
