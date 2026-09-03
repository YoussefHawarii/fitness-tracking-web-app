# Phase 1 Data Model: Manual Food Log by Name Search

No schema changes. Every entity below already exists in the codebase and is unmodified by this feature — this document maps the spec's Key Entities to those existing types so the frontend work in `tasks.md` references real names.

## Food Match → existing `UsdaFoodMatch`

Source: `Frontend/src/services/foodService.ts` (frontend type), backed by `Backend/src/modules/food/clients/usda.client.ts` (backend fetch from USDA) and returned by `GET /food/search-usda`.

| Field | Type | Notes |
|---|---|---|
| `fdcId` | `string` | USDA food ID; used as `sourceRef` when logging |
| `name` | `string` | Displayed to the user in the candidate list |
| `caloriesPer100g` | `number` | Used to compute calories for the entered grams |
| `proteinPer100g` / `carbsPer100g` / `fatPer100g` | `number \| null` | Optional macros, carried through to the computed log entry |

No new fields required. This is exactly what FR-002/FR-003 need.

## Custom Food Item → existing `LocalFoodItem`

Source: `Frontend/src/services/foodService.ts` (`LocalFoodItem`, `createLocalFoodItem`), backed by the `LocalFoodItem` Prisma model and `POST /food/local-items`.

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Used as `sourceRef` when logging (`sourceType: 'LOCAL'`) |
| `name` | `string` | User-supplied |
| `caloriesPer100g` | `number` | User-supplied — the only place in this feature where a human still types a calorie number, and only via the no-match fallback (FR-009) |
| `proteinPer100g` / `carbsPer100g` / `fatPer100g` | `number?` | Optional, user-supplied |

No changes. This is the existing fallback creation path, now reached only after a failed search (see quickstart.md).

## Food Log Entry → existing `FoodLogEntry` (via `CreateFoodLogDto`)

Source: `Backend/src/modules/food/dto/create-food-log.dto.ts`, persisted by `food.service.ts#createFoodLog`, read back by `Frontend/src/services/foodService.ts#listFoodLogsForDay`.

| Field | Type | Notes |
|---|---|---|
| `sourceType` | `'OPEN_FOOD_FACTS' \| 'USDA' \| 'LOCAL'` | Manual search-selected matches use `'USDA'`; fallback-created items use `'LOCAL'` |
| `sourceRef` | `string` | `fdcId` (USDA) or `LocalFoodItem.id` (LOCAL) |
| `grams` | `number` | User-entered, must be positive (FR-010, already validated by `@IsPositive()`) |
| `mealCategory` | `'BREAKFAST' \| 'LUNCH' \| 'DINNER' \| 'SNACKS'` | User-chosen (FR-006), already required by the DTO — no change |
| `loggedAtUtc` | `string` (ISO) | Set to "now" by the frontend, unchanged |
| *(server-computed)* `caloriesComputed`, `proteinComputed`, `carbsComputed`, `fatComputed` | `number \| null` | Computed server-side by `calculateNutrientsForGrams`, per FR-005 — the frontend never sends or edits a calorie figure |

No changes to this DTO or the underlying Prisma model are needed. `mealCategory` already applies uniformly regardless of `sourceType`, so US2/FR-006/FR-007 require no backend work — only confirming the manual path's UI reaches the same save step the other two paths already use.

## State flow (frontend component state only — no persistence changes)

```
[type food name] --search--> [candidate list (UsdaFoodMatch[])]
        |                            |
        | (zero results)             | (user picks one)
        v                            v
[fallback: create LocalFoodItem]  [pendingItem set: sourceType=USDA]
        |                            |
        v                            v
  [pendingItem set: sourceType=LOCAL] -----> [enter grams] --> [choose meal category] --> [save via existing createFoodLog]
```

This mirrors the state machine `FoodLog.tsx` already implements for barcode/voice (`pendingItem` → grams → mealCategory → `handleSaveLog`) — the only new piece is what populates `pendingItem` from the manual tab.
