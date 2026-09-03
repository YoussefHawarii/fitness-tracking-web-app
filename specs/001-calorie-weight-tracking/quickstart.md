# Quickstart: Validating Calorie & Weight Tracking Web App

Validation guide only — proves the four prioritized user stories from `spec.md` work end-to-end. Implementation steps belong in `tasks.md` (from `/speckit-tasks`), not here.

## Prerequisites

- Node.js 20 LTS, package manager of choice (npm/pnpm)
- A PostgreSQL connection string (Neon free-tier project, per `docs/technical-decisions.md`)
- A free USDA FoodData Central API key (Open Food Facts requires no key)
- A Google OAuth client ID/secret (for the Google sign-in path)
- Camera and microphone access in the browser used for manual verification (barcode scan and voice logging paths)

## Setup

```bash
# from repo root
cd Backend && npm install
cd ../Frontend && npm install
```

Configure environment variables (backend): database URL, JWT secret, USDA API key, Google OAuth client ID/secret. Configure environment variables (frontend): backend API base URL, Google OAuth client ID.

```bash
# apply schema
cd Backend && npx prisma migrate dev
```

## Run

```bash
# backend
cd Backend && npm run start:dev

# frontend
cd Frontend && npm run dev
```

## Validation Scenarios (map to `spec.md` Acceptance Scenarios)

1. **Baseline (User Story 1)**: Sign up with system email/password, complete onboarding (age, sex, height, weight, goal weight, activity level). Confirm a BMR/TDEE baseline is returned and displayed. Update weight in profile; confirm baseline recalculates (see `contracts/api.md` `onboarding`).
2. **Account linking (User Story 1)**: Sign up via system with an email, verify it, then sign in with Google using the same email. Confirm one merged account results, not two. Repeat with an *unverified* system email and confirm no silent merge occurs.
3. **Barcode logging (User Story 2)**: Scan a real packaged product's barcode. Confirm a match returns from Open Food Facts, grams entry produces a calculated calorie value, and the entry is saved under a chosen meal category. Then scan a barcode known to return no OFF data and confirm the app falls through to manual entry rather than logging a zero result (see `contracts/api.md` `/food/barcode/{code}`).
4. **Voice logging (User Story 2)**: Record a short phrase describing a food eaten. Confirm the transcript is shown for edit before any search occurs, candidate USDA matches are presented (not auto-selected), and choosing one plus entering grams produces a saved log entry.
5. **Manual entry (User Story 2)**: Create a local food item with a non-numeric calorie value and confirm it's rejected; then save a valid one and confirm it logs correctly and is not visible to a different test user account.
6. **Daily balance (User Story 3)**: With at least one food log for "today," view the daily summary and confirm consumed/expended/balance figures. Log an exercise entry for the same day and confirm expended calories increase accordingly; confirm balance for a day with no exercise log defaults to baseline TDEE alone.
7. **Day boundary (User Story 3)**: Log entries near local midnight and confirm they land in the correct calendar day per the account's timezone, not server time.
8. **Weight prediction (User Story 4)**: After logging a full week of daily balances, view the trend feature and confirm a predicted weight change appears, labeled as a directional estimate. With fewer days logged than the prediction window requires, confirm an explicit "insufficient data" state is shown instead of a number.
9. **Weigh-in comparison (User Story 4)**: Log an actual weigh-in for a date inside an existing prediction window and confirm predicted-vs-actual and the delta are both displayed; log one for a date outside any window and confirm only the actual value shows.

## Expected Outcome

All nine scenarios pass without requiring any paid service, and the full stack runs at $0 hosting cost per `spec.md` SC-007.
