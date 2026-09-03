# Phase 1 Data Model: Calorie & Weight Tracking Web App

Entities derived from `spec.md` Key Entities, with fields and rules pulled from `docs/business-logic.md` and `docs/architecture.md` §4. This is a logical model (field names/types are illustrative, not a Prisma schema); it belongs conceptually to the `account`, `onboarding`, `food-logging`, `calorie-balance`, and `weight-prediction` feature slices respectively.

## User (`account` feature)

Represents a registered account holder.

| Field | Type | Notes |
|---|---|---|
| id | identifier | Primary key |
| email | string | Unique; used for account-linking match |
| emailVerified | boolean | Gates whether this account is eligible for merge-by-email (FR-007, FR-008) |
| passwordHash | string, nullable | Present only if a system (email/password) credential exists |
| googleSubjectId | string, nullable | Present only if a Google credential is linked |
| timezone | string (IANA tz) | Captured at signup or from browser; used for all day-boundary math (FR-003, FR-021) |
| createdAt | timestamp | |

**Rules**:
- A `User` may have a system credential, a Google credential, or both (merged), but never two separate `User` rows for the same verified email (FR-007).
- Merge only occurs when the matching email is verified on the side being merged into (FR-008).

## UserBaseline (`onboarding` feature)

One current baseline per user — recalculated in place on relevant updates, not versioned/historized in v1.

| Field | Type | Notes |
|---|---|---|
| userId | identifier | 1:1 with User |
| age | integer | |
| sex | enum (male/female) | Determines which Mifflin-St Jeor variant applies |
| heightCm | decimal | |
| currentWeightKg | decimal | Updated as new weigh-ins are logged, or independently editable |
| goalWeightKg | decimal | |
| activityLevel | enum | Sedentary-to-light range only (FR-005) — must not represent an exercise-inclusive multiplier |
| bmr | decimal (computed) | Mifflin-St Jeor (FR-004) |
| tdee | decimal (computed) | `bmr × activityMultiplier` (FR-005) |
| updatedAt | timestamp | Bumped whenever recalculated (FR-006) |

**Rules**:
- Recalculate `bmr`/`tdee` whenever `age`, `heightCm`, or `currentWeightKg` changes (FR-006).
- `activityLevel` multiplier must stay in the non-exercise (sedentary-to-light, ~1.2–1.375) range to avoid double-counting exercise burn logged separately (FR-005).

## FoodItem (shared reference concept spanning `food-logging`)

Not a single table — three distinct sources, unified by shape at the point of use:

| Source | Identity | Scope |
|---|---|---|
| Open Food Facts product | external barcode | Shared/read-only across all users |
| USDA FoodData Central item | external food ID | Shared/read-only across all users |
| LocalFoodItem | internal id | Private to the creating user |

All three expose the same nutrient shape: **calories per 100g** (+ optional protein/carbs/fat per 100g), which `food-logging` uses uniformly for the gram-based calculation (FR-017).

### LocalFoodItem (`food-logging` feature)

| Field | Type | Notes |
|---|---|---|
| id | identifier | |
| userId | identifier | Owner — entry is private to this user (FR-016) |
| name | string, required | Validated non-empty on save (FR-015) |
| caloriesPer100g | decimal, required numeric | Validated as numeric, not validated for factual accuracy (FR-015) |
| proteinPer100g / carbsPer100g / fatPer100g | decimal, optional | Same numeric validation rule |
| createdAt | timestamp | |

## FoodLogEntry (`food-logging` feature)

| Field | Type | Notes |
|---|---|---|
| id | identifier | |
| userId | identifier | |
| sourceType | enum (open_food_facts / usda / local) | Which FoodItem source this entry resolved from |
| sourceRef | string | Barcode, USDA food ID, or LocalFoodItem id, depending on `sourceType` |
| grams | decimal, required, > 0 | Rejected if zero/negative (Edge Cases) |
| caloriesComputed | decimal (computed) | `(caloriesPer100g ÷ 100) × grams` (FR-017) |
| macrosComputed | object, optional | Same formula applied per macro, if tracked |
| mealCategory | enum (breakfast / lunch / dinner / snacks), required | Exactly one, user-selected (FR-018, per `spec.md` Assumptions) |
| loggedAtUtc | timestamp | Stored in UTC; grouped into a "day" using the owning user's timezone (FR-021) |

## ExerciseLogEntry (`calorie-balance` feature)

| Field | Type | Notes |
|---|---|---|
| id | identifier | |
| userId | identifier | |
| caloriesBurned | decimal, required, >= 0 | Optional per day — absence, not a zero row, is the default (FR-019) |
| loggedForDate | date (in user's local timezone) | One conceptual entry per day is typical, but not schema-enforced as unique in v1 |

## WeighIn (`weight-prediction` feature)

| Field | Type | Notes |
|---|---|---|
| id | identifier | |
| userId | identifier | |
| weightKg | decimal, required | |
| loggedForDate | date (in user's local timezone) | No fixed cadence — user logs whenever they choose (FR-024) |

**Derived, not stored**: predicted weight for `loggedForDate` and the predicted-vs-actual delta (FR-025) — computed at read time from `FoodLogEntry` + `ExerciseLogEntry` + `UserBaseline` history, not persisted as its own row, since it is a function of the balances already stored.

## Relationships (all enforced at the database level, FR-027)

```
User (1) ──── (1) UserBaseline
User (1) ──── (0..n) LocalFoodItem
User (1) ──── (0..n) FoodLogEntry
User (1) ──── (0..n) ExerciseLogEntry
User (1) ──── (0..n) WeighIn
FoodLogEntry (0..n) ──── (0..1) LocalFoodItem   [only when sourceType = local]
```

All child rows (`UserBaseline`, `LocalFoodItem`, `FoodLogEntry`, `ExerciseLogEntry`, `WeighIn`) carry a foreign key back to `User` with cascade-appropriate delete behavior left to implementation, per the referential-integrity requirement (FR-027).
