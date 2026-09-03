# Contracts: Existing Endpoints Reused by This Feature

This feature introduces **no new endpoints and no changes to existing ones**. It only changes which frontend UI calls the endpoints below, and in what sequence. Documented here for traceability from `tasks.md` back to a concrete contract.

All endpoints below require the existing `JwtAuthGuard` (`Authorization: Bearer <access token>`) and are unchanged by this feature.

## `GET /food/search-usda?term=<string>`

- **Used for**: FR-002/FR-003 — searching a typed food name and getting back recognized candidates.
- **Response**: `UsdaFoodMatch[]` — `{ fdcId: string; name: string; caloriesPer100g: number; proteinPer100g?: number|null; carbsPer100g?: number|null; fatPer100g?: number|null }[]`
- **Empty array** → triggers the FR-008 "no match found" state and the fallback path.
- **Source**: `Backend/src/modules/food/food.controller.ts:34-37`, `food.service.ts:27-29`.

## `POST /food/local-items`

- **Used for**: FR-009 fallback — creating a custom food item when search returns no matches.
- **Request body** (`CreateLocalFoodItemDto`): `{ name: string; caloriesPer100g: number; proteinPer100g?: number; carbsPer100g?: number; fatPer100g?: number }`
- **Response**: `LocalFoodItem` (includes generated `id`, used afterward as `sourceRef`).
- **Source**: `Backend/src/modules/food/food.controller.ts:39-45`, `dto/create-local-food-item.dto.ts`.

## `POST /food/logs`

- **Used for**: FR-004–FR-007, FR-010 — saving the final entry with grams, meal category, and computed calories.
- **Request body** (`CreateFoodLogDto`):
  ```json
  {
    "sourceType": "USDA | LOCAL",
    "sourceRef": "fdcId or LocalFoodItem.id",
    "grams": 150,
    "mealCategory": "BREAKFAST | LUNCH | DINNER | SNACKS",
    "loggedAtUtc": "2026-08-31T12:00:00.000Z"
  }
  ```
  Manual entry after this feature only ever sends `sourceType: "USDA"` (matched item) or `sourceType: "LOCAL"` (fallback-created item) — never `"OPEN_FOOD_FACTS"` (barcode-only).
- **Server behavior**: Looks up nutrients for `sourceRef` per `sourceType`, computes `caloriesComputed`/macros from `grams` via `calculateNutrientsForGrams`, persists with `mealCategory`. Rejects non-positive `grams` (`@IsPositive()`).
- **Response**: The created `FoodLogEntry`.
- **Source**: `Backend/src/modules/food/food.controller.ts:52-58`, `food.service.ts:78-101`.

## `GET /food/logs?date=<YYYY-MM-DD>`

- **Used for**: FR-007's "entry appears grouped under that meal" verification — already used by `FoodLog.tsx` to render the day's grouped list, unchanged.
- **Source**: `Backend/src/modules/food/food.controller.ts:60-71`.
