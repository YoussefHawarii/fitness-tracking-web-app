# Quickstart: Validating Dashboard History Calendar & Time-Aware Greeting

Touches both `Backend/` (additive schema field, response field, query validation) and `Frontend/` (Dashboard UI). Requires a schema push before first run.

## Prerequisites

- Backend running locally with its usual env vars set (`Backend/.env.example`).
- After pulling this feature's schema change: `cd Backend && npx prisma db push && npx prisma generate` (no `migrations/` directory in this project — see CLAUDE.md).
- Frontend dev server running against that backend (`VITE_API_BASE_URL` pointed at it).
- A logged-in test user who has completed onboarding (has a baseline — required for `GET /profile` and `GET /balance` already, unchanged by this feature) with a known account `timezone`.
- At least one food entry and one exercise entry logged on a *past* date (not today) for that user — either via the app's existing logging flows with a manually adjusted date, or seeded directly.

```bash
# Backend
cd Backend && npm run start:dev

# Frontend (separate terminal)
cd Frontend && npm run dev
```

## Scenario 1 — View a past day's food and exercise history (User Story 1 + 2)

1. Log in and open the Dashboard.
2. Open the calendar/date control and select a date with known logged food and exercise entries (e.g. yesterday).
3. **Expect**: the Dashboard updates to show that date's food items (with readable names, not IDs) and total calories consumed, plus that date's exercise sessions and total calories burned.
4. **Expect**: the Dashboard clearly indicates the displayed date is not "today" (FR-005).
5. Select "back to today" (or equivalent).
6. **Expect**: the Dashboard returns to live current-day data.

Validates: FR-001–FR-006, FR-009, SC-001, SC-002, SC-003.

## Scenario 2 — Past date with no data (Edge Case / FR-007)

1. Select a past date with no food or exercise logged at all.
2. **Expect**: both sections show a clear empty state (zero calories, "nothing logged"), not an error and not stale data from a previously viewed date.

Validates: FR-007.

## Scenario 3 — Future date blocked (FR-002)

1. Open the calendar control.
2. **Expect**: dates after today are not selectable (grayed out / disabled by the native date input's `max`).

Validates: FR-002.

## Scenario 4 — Backend rejects a malformed date (defense-in-depth)

1. With a valid access token, call `GET /balance?date=not-a-date` (or `/exercise-logs`, `/food/logs`) directly (e.g. via curl/Postman).
2. **Expect**: `400 Bad Request`, not a silently wrong/empty result.

Validates: the query-validation decision in research.md, supporting FR-008.

## Scenario 5 — Greeting follows account timezone, not device clock (User Story 3)

1. Set the test user's account `timezone` (via existing onboarding/profile update) to a zone whose current local hour is clearly in one greeting band (e.g. before noon) while the test device's system clock is in a different band.
2. Load the Dashboard.
3. **Expect**: the greeting matches the account timezone's local hour band (FR-011, FR-012), not the device's.

Validates: FR-011, FR-012, SC-004.

## What "done" looks like

All five scenarios pass manually in the browser (per CLAUDE.md, UI changes are verified visually in the dev server). Run `cd Backend && npm test` for the new/updated `name`-capture and date-validation unit tests, and `npm run test:e2e` locally per CLAUDE.md since backend behavior (response shapes, validation) changed. No frontend automated test suite exists to run (consistent with prior specs).
