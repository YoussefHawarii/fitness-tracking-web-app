# Quickstart: Click-to-Open Date Picker & Editable Food Log

Manual/e2e validation guide for the three user stories in [spec.md](spec.md). No new environment variables or setup beyond what's already documented in the root `CLAUDE.md`.

## Prerequisites

- Backend running with a valid `.env` (`Backend/.env`, see `Backend/.env.example`) and `npm run start:dev` (or equivalent) from `Backend/`.
- Frontend running via `npm run dev` from `Frontend/`, pointed at the backend (`VITE_API_BASE_URL`).
- A logged-in test account with at least a baseline weight set (required for the app generally, unrelated to this feature).

## Story 1 — One-click date picker

1. Open the Dashboard.
2. Click anywhere in the date field's box — the visible text, the padding around it, not just the small calendar glyph on the right.
3. **Expected**: the browser's native calendar dropdown opens immediately.
4. Pick a past date from the dropdown. **Expected**: the dropdown closes, the Dashboard reloads its balance/food/exercise sections for that date, and "Back to today" appears.
5. Tab to the date field with the keyboard (no mouse) and press Enter or Space. **Expected**: the calendar dropdown still opens (keyboard access preserved — FR-003).

## Story 3 — Edit and delete a food log entry

*(Validated before Story 2 since Story 2 depends on it having something to navigate to.)*

1. Go to Log food → Manual, search/add a food item, enter e.g. `100` grams, save it.
2. On the Food Log page, find the entry just created — it now shows an edit control and a delete control.
3. Click edit, change grams to `200`, save.
   **Expected**: the entry's displayed calories (and other nutrients) roughly double, matching what a fresh 200g entry of the same food would show; `PATCH /food/logs/:id` returns `200` with the recomputed values (contracts/food-logs-edit-delete.md).
4. Click edit again, clear the grams field or enter `0`/`-5`, try to save.
   **Expected**: save is rejected with a clear error message; the entry's stored grams remains `200`.
5. Click cancel on an open edit form without saving. **Expected**: entry unchanged.
6. Click delete on the entry, confirm.
   **Expected**: the entry disappears from the Food Log page; a `GET /food/logs?date=...` call no longer includes it; `DELETE /food/logs/:id` returned `204`.
7. Click delete again on a stale reference to the same (already-deleted) entry (e.g. re-trigger the same request via devtools, or open two tabs and delete from both).
   **Expected**: the second attempt shows an "already removed"-style message rather than a raw error, and the list is (re)fetched.

## Story 2 — Home page food items link to Food Log

1. Log at least one food item for today (Story 3, step 1).
2. Go to the Dashboard. **Expected**: the "Food logged" section shows the same name and calories as the Food Log page for that entry (already true today — confirms FR-004's sync still holds).
3. Click that food item in the Dashboard's list.
   **Expected**: navigation lands on the Food Log page, and the entry from step 1 is visible there (same date — today).
4. On the Dashboard, use the date picker (Story 1) to view a past date that has logged food (log one for yesterday first if needed, e.g. by adjusting `loggedAtUtc` via a fresh log now and checking it under today, or by using an account/day with existing history).
5. Click a food item shown for that past date.
   **Expected**: navigation lands on the Food Log page scoped to that same past date (`/food-log?date=YYYY-MM-DD`), not today's log.

## Automated coverage (backend)

- `Backend/test/food.e2e-spec.ts` (new or extended): cover `PATCH /food/logs/:id` happy path (grams change recomputes calories), validation failure (grams ≤ 0), 404 for another user's entry, and `DELETE /food/logs/:id` happy path + 404 on second delete. Run via `npm run test:e2e` from `Backend/` per project convention (not part of CI, run locally for this change).
- Existing `food.service.spec.ts` / `food.controller.spec.ts` (if present) extended with unit tests for `updateFoodLog`/`deleteFoodLog`. Run via `npm test` from `Backend/`.

No frontend automated test run — verify Stories 1–3 manually in the browser per above, plus `npm run build` and `npm run lint` from `Frontend/` to confirm no type/lint regressions.
