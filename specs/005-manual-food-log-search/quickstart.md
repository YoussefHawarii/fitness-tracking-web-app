# Quickstart: Validating Manual Food Log by Name Search

Frontend-only change. No new environment variables or migrations — use the existing dev setup.

## Prerequisites

- Backend running locally with its usual env vars set (`Backend/.env.example`), including `USDA_API_KEY` — required for `/food/search-usda` to return real results.
- Frontend dev server running against that backend (`VITE_API_BASE_URL` pointed at it).
- A logged-in test user (email/password + OTP, or Google sign-in per existing auth flow).

```bash
# Backend
cd Backend && npm run start:dev

# Frontend (separate terminal)
cd Frontend && npm run dev
```

## Scenario 1 — Recognized food, full happy path (User Story 1 + 2)

1. Open the food log page, select the **Manual** tab.
2. Type a common food name (e.g. "banana") and trigger search.
3. **Expect**: a list of candidate foods appears, each showing a name (and ideally calorie density) — no calorie input field is visible anywhere in this step.
4. Select one candidate.
5. **Expect**: the page advances to the existing grams + meal-category step (same UI already used for barcode/voice).
6. Enter a gram amount (e.g. `120`) and choose a meal category (e.g. `Dinner`).
7. Save.
8. **Expect**: a success message appears; the entry appears under the **Dinner** section of the day's food log with a calorie value computed automatically (not typed by the user), and Dinner's subtotal includes it.

Validates: FR-001 through FR-007, SC-001, SC-002, SC-003.

## Scenario 2 — No match found, fallback path (User Story 3)

1. On the Manual tab, search a made-up/unlikely food name (e.g. "zzqqfoobar123").
2. **Expect**: the system reports no matches found and offers a fallback option.
3. Choose the fallback; provide a name and a calorie-per-100g value.
4. **Expect**: proceeds to the same grams + meal-category + save step as Scenario 1, and completes successfully.

Validates: FR-008, FR-009, SC-004.

## Scenario 3 — Invalid grams rejected (Edge Case)

1. Complete a search and select a match (per Scenario 1, steps 1–4).
2. Leave grams blank, or enter `0` or a negative number.
3. Attempt to save.
4. **Expect**: save is rejected with a prompt to enter a valid positive amount; no entry is created.

Validates: FR-010.

## Scenario 4 — Existing paths unaffected (FR-011 regression check)

1. Use the **Scan** (barcode) tab to log a product with a real barcode.
2. Use the **Voice** tab to log a food by speaking/typing a transcript and picking a match.
3. **Expect**: both continue to work exactly as before — candidate selection, grams entry, meal-category choice, save, and grouped display all behave unchanged.

Validates: FR-011 (no regression to barcode/voice paths).

## What "done" looks like

All four scenarios pass manually in the browser (per CLAUDE.md, this is a frontend/UI change — verify visually in the dev server, not just via type-checking). No backend test suite changes are expected or required, since `Backend/src/modules/food/*` is untouched by this feature.
