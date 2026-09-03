# Phase 0 Research: Exercise Tracking Page

No `NEEDS CLARIFICATION` markers remain in the Technical Context — this project's stack, storage, and testing conventions are already established (see CLAUDE.md and the existing `calorie-balance` module). The decisions below cover the feature-specific choices needed before design.

## Decision: Calorie calculation formula

- **Decision**: `calories = MET × weight(kg) × duration(hours)`, computed server-side at log/edit time and stored as the entry's `caloriesBurned` value (same column that already exists).
- **Rationale**: This is the standard, widely-documented method for estimating exercise energy expenditure from activity type, body mass, and duration, consistent with how the app already uses a standard formula (Mifflin-St Jeor) for BMR rather than inventing a bespoke calculation. It requires no external API or device data, keeping the feature fully self-contained like the rest of the calorie-balance module.
- **Alternatives considered**:
  - *Heart-rate/device-based estimation* — rejected: requires wearable integration, far outside this feature's scope and the app's current data model.
  - *Flat calories-per-minute per sport (no weight factor)* — rejected: less accurate, and the app already collects baseline weight during onboarding, so using it is free.

## Decision: MET value table for the fixed sport list

- **Decision**: A small in-code constant table maps each of the 7 named sports to a representative MET value, using generally published MET compendium ranges:
  | Sport | MET |
  |---|---|
  | Running | 9.8 (general jogging/running, ~8 km/h pace) |
  | Football (soccer) | 7.0 (general play) |
  | Swimming | 7.0 (general, moderate/vigorous effort) |
  | Padel | 6.0 (comparable to recreational tennis/racquet sport) |
  | Basketball | 6.5 (general, non-competitive) |
  | Gym / Weight Training | 5.0 (moderate effort, general resistance training) |
  | Tennis | 7.3 (general, singles) |
  | Other (general) | 5.0 (moderate general activity default) |
- **Rationale**: These are single representative values rather than intensity-tiered options, matching the spec's scope (no requirement for the user to also indicate effort/intensity level — duration and sport alone are the inputs). Values are deliberately mid-range/general-activity estimates, not vigorous-competitive maximums, to avoid overstating calories for casual sessions.
- **Alternatives considered**:
  - *Ask the user for intensity (light/moderate/vigorous) per sport* — rejected: adds a second input to every log action, contradicting the spec's SC-001 ("log a session in under 15 seconds") and FR-003 wording (sport + duration only).
  - *Per-sport MET sourced from a live external database* — rejected: unnecessary network dependency and complexity for a fixed, small catalog.

## Decision: "Other" sport handling

- **Decision**: Selecting "Other" reveals a required free-text field for the activity name; the stored `sportType` is a fixed enum value `OTHER` and the typed name is stored separately (`customSportName`); calorie calculation always uses the "Other" default MET (5.0) regardless of what's typed.
- **Rationale**: Matches FR-002a directly. Keeping `sportType` an enum (rather than accepting arbitrary strings as the type) keeps the predefined-list validation and future analytics/filtering simple, while `customSportName` preserves the user's own label for display.
- **Alternatives considered**: Free-text sport type field with no enum — rejected, would complicate validation and mix free text with the fixed catalog in one column.

## Decision: Duration input and validation bounds

- **Decision**: Duration entered and stored in whole minutes; validated as an integer between 1 and 1440 (24 hours), per FR-004/edge cases.
- **Rationale**: Minutes is the natural unit for typical session lengths (a 30-minute run, a 90-minute football match) and matches how the spec frames the requirement ("how long I've been playing"). 1440 minutes is the existing edge-case sanity bound documented in the spec.
- **Alternatives considered**: Hours with decimals — rejected as less natural for quick entry of typical session lengths (e.g. "45" vs "0.75").

## Decision: Ownership enforcement for edit/delete

- **Decision**: The new PATCH/DELETE endpoints look up the `ExerciseLogEntry` by `id` scoped to the authenticated user's `userId` in the same `where` clause (`prisma.exerciseLogEntry.updateMany`/`deleteMany` with `{ id, userId }`, or a `findFirst` ownership check before `update`/`delete`), returning 404 if no row matches — the same pattern already used implicitly elsewhere in the app via `@CurrentUser()` + userId-scoped queries.
- **Rationale**: Matches FR-008 and the existing app-wide convention of deriving `userId` from the JWT (`@CurrentUser()`) rather than trusting a client-supplied user id, so cross-user access is structurally impossible rather than checked after the fact.
- **Alternatives considered**: Fetch by id only, then compare `entry.userId === user.userId` and throw `ForbiddenException` — functionally equivalent; the scoped-query approach is preferred because it's the existing pattern in this codebase (see `foodLogEntry`/`userId` scoping elsewhere) and avoids leaking existence of other users' entries via a 403 vs 404 distinction.

## Decision: Day-boundary and baseline reuse

- **Decision**: Reuse `getDayBoundaryUtc` and the existing `UserBaseline.currentWeightKg` lookup already used by `CalorieBalanceService.getDailyBalance`; no new day-boundary or weight-lookup logic is introduced.
- **Rationale**: Keeps "today" scoping (FR-009) and the baseline-required check (FR-005) consistent with how the rest of the calorie-balance module already defines "today" and consumes baseline data — avoids two different definitions of "today" in the same module.
- **Alternatives considered**: None — this is a direct reuse of existing, already-tested code (`day-boundary.util.ts`).

## Decision: Frontend replacement of the quick-entry form

- **Decision**: `ExerciseLogForm.tsx` is deleted; the Dashboard's exercise section becomes a link/button into the new `/exercise` page, plus the existing read-only "Exercise" stat tile (unchanged).
- **Rationale**: Matches FR-013 and the Assumptions section — one way to log exercise, not two, avoiding the confusion of a raw-calorie shortcut existing alongside the sport-based flow.
- **Alternatives considered**: Keep both — rejected per explicit spec assumption (avoids duplicate/inconsistent logging paths for the same data).
