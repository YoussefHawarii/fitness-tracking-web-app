# Phase 1 Data Model: Exercise Tracking Page

## Entity: ExerciseLogEntry (extended)

Existing Prisma model `ExerciseLogEntry` (table `exercise_log_entries`), extended with two new columns. No new table is created — this is a schema extension applied via `prisma db push`, consistent with every other schema change in this project.

| Field | Type | Notes |
|---|---|---|
| `id` | `String` (uuid, PK) | Existing, unchanged |
| `userId` | `String` (FK → User, cascade delete) | Existing, unchanged — always derived from the authenticated JWT, never client-supplied |
| `caloriesBurned` | `Decimal` | Existing column; semantics unchanged (still the calculated calorie value for the session), but now always *server-calculated* from `sportType`/`customSportName` + `durationMinutes` + baseline weight, rather than accepted directly from the client |
| `loggedForDate` | `DateTime @db.Date` | Existing, unchanged — the local date (per user timezone) this session counts toward |
| `sportType` | `SportType` (new enum column) | **NEW** — one of the fixed catalog values, see enum below |
| `customSportName` | `String?` (new, nullable) | **NEW** — required (non-null) when `sportType = OTHER`; the user's typed activity name; unused/null for all other sport types |
| `durationMinutes` | `Int` (new) | **NEW** — validated 1–1440 |

### New enum: SportType

```prisma
enum SportType {
  FOOTBALL
  SWIMMING
  PADEL
  BASKETBALL
  GYM_WEIGHTS
  RUNNING
  TENNIS
  OTHER
}
```

### Validation rules

- `sportType` MUST be one of the enum values above (FR-002).
- `customSportName` MUST be present and non-empty when `sportType = OTHER`; MUST be absent/ignored otherwise (FR-002a).
- `durationMinutes` MUST be an integer in `[1, 1440]` (FR-004, edge cases).
- Create/edit MUST be rejected (400) if the requesting user has no `UserBaseline` row — calorie calculation cannot proceed without `currentWeightKg` (FR-005).
- Edit/delete MUST only succeed when `id` belongs to the requesting user's `userId` (FR-006, FR-007, FR-008) — otherwise 404.
- `caloriesBurned` is **derived, not accepted from the client** on create/edit — it is recalculated server-side every time `sportType`/`customSportName`/`durationMinutes` change, per the formula in `research.md` ("Decision: Calorie calculation formula").

### Relationships

- Unchanged: `ExerciseLogEntry.userId` → `User.id` (existing FK, cascade delete — unaffected by this feature).
- Read-only dependency (not a stored relation): calorie calculation reads `UserBaseline.currentWeightKg` for the requesting user at calculation time; past entries are **not** retroactively recalculated if baseline weight changes later (per spec Edge Cases / Assumptions — historical point-in-time record, same convention as other historical data in this app).

## Reference data (not a DB table): Sport → MET table

A fixed, in-code constant (`Backend/src/modules/calorie-balance/exercise-met-table.ts`), not persisted in the database — this is app configuration, not user data, consistent with the spec's Assumptions ("fixed, app-defined list for v1 — not admin-manageable").

| `SportType` | MET value |
|---|---|
| `RUNNING` | 9.8 |
| `FOOTBALL` | 7.0 |
| `SWIMMING` | 7.0 |
| `PADEL` | 6.0 |
| `BASKETBALL` | 6.5 |
| `GYM_WEIGHTS` | 5.0 |
| `TENNIS` | 7.3 |
| `OTHER` | 5.0 |

## State / lifecycle

`ExerciseLogEntry` has no status field or state machine — it is a simple create/update/delete record, same lifecycle shape as the existing `WeighIn` and `FoodLogEntry` models in this schema. No transitions to model beyond existence.
