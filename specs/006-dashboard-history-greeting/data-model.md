# Phase 1 Data Model: Dashboard History Calendar & Time-Aware Greeting

No new tables. One additive, nullable column on an existing table; one existing column (already present) newly exposed through an existing endpoint's response.

## `FoodLogEntry` (existing table, modified)

| Field | Type | Change | Notes |
|---|---|---|---|
| `name` | `String` (`@default("")`) | **NEW** | Human-readable name of the food, snapshotted at log-creation time. Populated from `UsdaFoodMatch.name`, `OpenFoodFactsProduct.name`, or `LocalFoodItem.name` depending on `sourceType`. Defaults to `""` for rows created before this feature — frontend renders a fallback label ("Food item") when empty. (Implemented as a non-nullable `name` column with a `""` default rather than the originally planned nullable `foodName`, to match the actual schema/code state found at implementation time — same "no backfill needed" behavior either way.) |

All other existing fields (`id`, `userId`, `sourceType`, `sourceRef`, `localFoodItemId`, `grams`, `caloriesComputed`, `proteinComputed`, `carbsComputed`, `fatComputed`, `mealCategory`, `loggedAtUtc`) are unchanged.

**Validation rule**: `name` is populated server-side only, inside `FoodService.createFoodLog` — never accepted as client input (`CreateFoodLogDto` gains no new field), so a caller cannot spoof a food's display name.

## `User` (existing table, unchanged — field newly exposed)

| Field | Type | Change | Notes |
|---|---|---|---|
| `timezone` | `String` | **EXPOSED** (no schema change) | Already exists and already populated during onboarding (`UsersService`, `UpdateProfileDto`/onboarding flow). Newly included in `GET /profile`'s response so the frontend can read it. IANA format (e.g. `"America/New_York"`), same value already consumed server-side by `getDayBoundaryUtc`. |

## Derived/display concepts (not persisted)

- **Selected history date**: Frontend-only state in `Dashboard.tsx` — an ISO `YYYY-MM-DD` string, defaulting to "today" computed from the account's `timezone` (via `Intl.DateTimeFormat`) rather than the browser's local `Date`. Bounded to `<= today` (FR-002); not persisted anywhere, resets to "today" on next page load.
- **Greeting period**: Derived, not stored — one of `"Good morning" | "Good afternoon" | "Good evening"`, computed from the current hour in the account's `timezone` (FR-012: `< 12` → morning, `12–17` → afternoon, `>= 18` → evening).

## Query parameter contract (existing routes, tightened validation)

| Route | Param | Existing type | New validation |
|---|---|---|---|
| `GET /balance` | `date` | `string` (unvalidated) | `@IsDateString()` — 400 on malformed value |
| `GET /exercise-logs` | `date` | `string` (unvalidated) | `@IsDateString()` — 400 on malformed value |
| `GET /food/logs` | `date` | `string` (unvalidated) | `@IsDateString()` — 400 on malformed value |

No change to the semantics of a *valid* date string — still interpreted as a calendar day in the account's timezone via the existing `getDayBoundaryUtc(dateStr, timezone)`.
