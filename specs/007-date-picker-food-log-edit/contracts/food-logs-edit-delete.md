# Contract: Food Log Entry Edit & Delete

Extends the existing `food` module's HTTP surface (`Backend/src/modules/food/food.controller.ts`, mounted at `/food`). Both routes require the existing `JwtAuthGuard` (same as every other route in this controller).

## `PATCH /food/logs/:id`

Edits an existing food log entry's gram amount and/or meal category. Any provided field is recomputed/persisted; omitted fields keep their current value.

**Auth**: Bearer access token (existing `JwtAuthGuard`). The entry must belong to the authenticated user.

**Path params**:
| Name | Type | Notes |
|---|---|---|
| `id` | string (uuid) | The food log entry to edit. |

**Request body** (`UpdateFoodLogDto`):
```json
{
  "grams": 150,
  "mealCategory": "LUNCH"
}
```
| Field | Type | Required | Validation |
|---|---|---|---|
| `grams` | number | optional | positive number (> 0) when provided |
| `mealCategory` | `"BREAKFAST" \| "LUNCH" \| "DINNER" \| "SNACKS"` | optional | must be a valid `MealCategory` enum value when provided |

**Response `200 OK`** — the updated entry, same shape as `POST /food/logs` / `GET /food/logs` already return:
```json
{
  "id": "…",
  "sourceType": "USDA",
  "sourceRef": "…",
  "localFoodItemId": null,
  "name": "Grilled chicken breast",
  "grams": "150",
  "caloriesComputed": "247.5",
  "proteinComputed": "46.5",
  "carbsComputed": "0",
  "fatComputed": "5.4",
  "mealCategory": "LUNCH",
  "loggedAtUtc": "2026-08-31T12:00:00.000Z"
}
```

**Error responses**:
| Status | Condition |
|---|---|
| `400 Bad Request` | `grams` ≤ 0, non-numeric, or `mealCategory` not a valid enum value (DTO validation failure) |
| `401 Unauthorized` | Missing/invalid access token |
| `404 Not Found` | No entry with that `id` belongs to the authenticated user (covers both "doesn't exist" and "belongs to someone else" — FR-011) |

## `DELETE /food/logs/:id`

Permanently removes a food log entry.

**Auth**: Bearer access token. The entry must belong to the authenticated user.

**Path params**:
| Name | Type | Notes |
|---|---|---|
| `id` | string (uuid) | The food log entry to delete. |

**Response**: `204 No Content` (mirrors `DELETE /exercise-logs/:id`), empty body.

**Error responses**:
| Status | Condition |
|---|---|
| `401 Unauthorized` | Missing/invalid access token |
| `404 Not Found` | No entry with that `id` belongs to the authenticated user — this is the response the frontend surfaces as "already removed" for the double-delete edge case |

## Frontend service additions (`Frontend/src/services/foodService.ts`)

```ts
export async function updateFoodLog(
  id: string,
  input: { grams?: number; mealCategory?: MealCategory },
): Promise<FoodLogEntry> {
  const { data } = await apiClient.patch(`/food/logs/${id}`, input);
  return data;
}

export async function deleteFoodLog(id: string): Promise<void> {
  await apiClient.delete(`/food/logs/${id}`);
}
```

No other existing contracts (`POST /food/logs`, `GET /food/logs`, barcode/USDA/local-item routes) change.
