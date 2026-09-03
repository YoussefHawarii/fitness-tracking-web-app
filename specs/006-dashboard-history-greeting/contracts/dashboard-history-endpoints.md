# Contracts: Endpoints Used/Changed by This Feature

All endpoints below require the existing `JwtAuthGuard` (`Authorization: Bearer <access token>`). None are new; all changes are additive (new response field, new/tightened validation) — no existing field is removed or renamed.

## `GET /balance?date=<YYYY-MM-DD>`

- **Used for**: FR-003 — the day's total calories consumed/expended.
- **Change**: `date` gains `@IsDateString()` validation → `400 Bad Request` for a malformed value (previously silently produced an `Invalid Date` boundary). No response shape change.
- **Response** (unchanged): `DailyBalance` — `{ caloriesConsumed: number; caloriesExpended: number; caloriesBurnedExercise: number; balance: number }`
- **Source**: `Backend/src/modules/calorie-balance/calorie-balance.controller.ts`.

## `GET /exercise-logs?date=<YYYY-MM-DD>`

- **Used for**: FR-004 — the day's exercise sessions.
- **Change**: same `date` validation as above. No response shape change.
- **Response** (unchanged): `ExerciseSession[]` — `{ id: string; sportType: SportType; customSportName: string | null; durationMinutes: number; caloriesBurned: string; loggedForDate: string }[]`
- **Source**: `Backend/src/modules/calorie-balance/calorie-balance.controller.ts`.

## `GET /food/logs?date=<YYYY-MM-DD>`

- **Used for**: FR-003 — the day's itemized food entries.
- **Change**: same `date` validation as above. Response rows gain `name: string` (see data-model.md). Existing fields unchanged.
- **Response** (extended): `FoodLogEntry[]` — `{ id: string; sourceType: FoodSourceType; sourceRef: string; localFoodItemId: string | null; name: string; grams: number; caloriesComputed: number; proteinComputed: number | null; carbsComputed: number | null; fatComputed: number | null; mealCategory: MealCategory; loggedAtUtc: string }[]`
- **Source**: `Backend/src/modules/food/food.controller.ts`.

## `GET /profile`

- **Used for**: FR-010/FR-011 — reading the account's IANA timezone to drive both the calendar's day boundary and the greeting.
- **Change**: Response gains `timezone: string`. Existing fields (`age`, `sex`, `heightCm`, `currentWeightKg`, `goalWeightKg`, `activityLevel`, `bmr`, `tdee`) unchanged. Existing `404` behavior when no baseline exists is unchanged (this feature does not relax that precondition — the Dashboard already depends on baseline data existing via `GET /balance`).
- **Response** (extended): `UserBaseline & { timezone: string }`
- **Source**: `Backend/src/modules/users/users.service.ts` (`getProfile`), `users.controller.ts`.
