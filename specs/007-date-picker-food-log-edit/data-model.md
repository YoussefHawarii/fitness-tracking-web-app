# Data Model: Click-to-Open Date Picker & Editable Food Log

No new tables, columns, or enums. This feature adds mutation operations on an existing entity; the Prisma schema (`Backend/prisma/schema.prisma`) is unchanged.

## Entity: FoodLogEntry (existing — `food_log_entries`)

| Field | Type | Notes |
|---|---|---|
| `id` | `String` (uuid) | Unchanged. Identifies the entry for edit/delete. |
| `userId` | `String` | Unchanged. Used for ownership checks on edit/delete (FR-011). |
| `sourceType` | `FoodSourceType` (`OPEN_FOOD_FACTS` \| `USDA` \| `LOCAL`) | Unchanged, **not editable** by this feature — re-read on edit to recompute nutrients. |
| `sourceRef` | `String` | Unchanged, **not editable** — see above. |
| `name` | `String` | Unchanged, **not editable**. |
| `localFoodItemId` | `String?` | Unchanged, **not editable**. |
| `grams` | `Decimal` | **Editable.** Must remain a positive number (FR-008). Drives recomputation of all derived nutrient fields below. |
| `caloriesComputed` | `Decimal` | Derived — recomputed server-side from `grams` on edit (FR-007). Never set directly by the client. |
| `proteinComputed` | `Decimal?` | Derived — recomputed alongside `caloriesComputed`. |
| `carbsComputed` | `Decimal?` | Derived — recomputed alongside `caloriesComputed`. |
| `fatComputed` | `Decimal?` | Derived — recomputed alongside `caloriesComputed`. |
| `mealCategory` | `MealCategory` (`BREAKFAST` \| `LUNCH` \| `DINNER` \| `SNACKS`) | **Editable.** |
| `loggedAtUtc` | `DateTime` | Unchanged, **not editable** by this feature — the entry stays associated with the day/time it was originally logged. |

### Validation rules (edit)

- `grams`, if provided, must be a number > 0 (mirrors `CreateFoodLogDto`'s existing grams validation).
- `mealCategory`, if provided, must be one of the four existing `MealCategory` enum values.
- At least conceptually a no-op edit (neither field provided) is harmless — it simply re-persists the current values — but the frontend form always sends both fields since they're both always visible in the edit control.
- Ownership: the entry must belong to the authenticated user (`userId` match), enforced identically to `ExerciseLogEntry` edit/delete.

### State transitions

None — this is a flat CRUD-style mutation, not a workflow with distinct states. Delete is a hard removal (matches `deleteExercise`'s behavior — no soft-delete/undo, consistent with the rest of the app).

## Frontend view-model additions

- **`FoodLogEntry` (frontend, `foodService.ts`)**: no field changes; the existing shape already returned by `listFoodLogsForDay` is reused for rendering edit/delete controls and for the Dashboard's food list.
- **Selected date (Food Log page)**: transient, URL-driven (`?date=YYYY-MM-DD` query param), not persisted — see `research.md` §4. Not a data entity, just a view parameter.
