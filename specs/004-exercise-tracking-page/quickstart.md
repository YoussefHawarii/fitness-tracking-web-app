# Quickstart: Exercise Tracking Page

Validation guide for confirming the feature works end-to-end once implemented. Assumes both dev servers are running (`Backend`: `npm run start:dev`, `Frontend`: `npm run dev`) and you have a logged-in test user who has already completed onboarding (has a `UserBaseline` row — required per FR-005).

## Prerequisites

- Backend `.env` configured (per CLAUDE.md required env vars) and `npx prisma db push && npx prisma generate` run after the schema change in `data-model.md` is applied.
- A test user, verified and onboarded (baseline weight on file).

## Scenario 1 — Log a session (User Story 1 / SC-001, SC-003)

1. Sign in, navigate to the new Exercise page (linked from the Dashboard).
2. Select "Running", enter duration `30` (minutes), save.
3. **Expect**: a new session appears in today's list showing "Running", "30 min", and a non-zero calculated calorie value — with no calorie field ever having been typed by hand.
4. Cross-check via `GET /balance?date=<today>` — `caloriesBurnedExercise` includes this session's calories.

## Scenario 2 — "Other" sport with typed name (FR-002a)

1. On the Exercise page, select "Other", type "Rock Climbing", enter duration `40`, save.
2. **Expect**: the session lists as "Rock Climbing" (the typed name), with calories calculated using the "Other" default MET (5.0) from `research.md`.

## Scenario 3 — Reject invalid duration (FR-004)

1. Attempt to save a session with duration `0` and separately with duration `1500` (over the 1440 cap).
2. **Expect**: both attempts are rejected with a clear explanation; no entry is created.

## Scenario 4 — Block logging without a baseline (FR-005)

1. Using a test user with no `UserBaseline` row, attempt to log any session.
2. **Expect**: the app explains a baseline is required (points to onboarding) instead of creating an entry with a garbage/zero calorie value.

## Scenario 5 — Edit an entry in place (User Story 2 / SC-002)

1. From Scenario 1's session, edit duration from `30` to `20`.
2. **Expect**: the same entry (same id) updates — its listed duration and calorie value change, no duplicate entry appears, and the Dashboard's "Exercise" total decreases to match.
3. Edit the sport instead (e.g. Running → Swimming) and confirm calories recalculate using Swimming's MET.
4. As a second user, attempt `PATCH /exercise-logs/:id` on the first user's entry id directly (e.g. via a script/API client) — **expect** `404`.

## Scenario 6 — Delete an entry (User Story 3)

1. Delete the session from Scenario 5.
2. **Expect**: it disappears from the Exercise page list immediately (no reload needed, per SC-005) and the Dashboard's "Exercise" total decreases accordingly.

## Scenario 7 — Day list and dashboard consistency (User Story 4 / SC-004)

1. Log two more sessions today (e.g. Football 60 min, Padel 45 min).
2. **Expect**: the Exercise page lists all sessions for today, most recent first, and its displayed total equals the sum shown.
3. Navigate to the Dashboard — **expect** the "Exercise" tile shows the identical total.
4. Confirm the Dashboard's "Expended" and "Balance"/"remaining calories" figures are unaffected by any of the exercise logging above (FR-012 — unchanged from the prior decoupling work).

## Scenario 8 — Empty state (User Story 4)

1. Using a fresh test user (baseline present, no exercise logged yet today), open the Exercise page.
2. **Expect**: an empty-state message, not an error or a blank/broken layout.

## Cleanup

Delete any test users/entries created for this validation pass, following the same pattern used elsewhere in this project (seed via script, verify, delete via script) — see prior session notes for the established throwaway-test-user pattern.
