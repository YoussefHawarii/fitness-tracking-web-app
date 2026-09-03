# Research: Click-to-Open Date Picker & Editable Food Log

All unknowns from the Technical Context are resolved below; there were no open `NEEDS CLARIFICATION` markers carried over from the spec.

## 1. Making the native `<input type="date">` open on any click

**Decision**: Call the input element's `showPicker()` method from an `onClick` handler on the input itself (with a `pointerdown`-safe guard so it doesn't double-fire with the browser's own icon-click behavior), rather than replacing the native input with a custom calendar component.

**Rationale**: `HistoryDatePicker.tsx` already made a deliberate choice (documented in its own comment, referencing an earlier feature's `research.md`) to use the native `<input type="date">` instead of a calendar widget library, to get free accessibility, keyboard support, mobile OS pickers, and OS-consistent styling. `HTMLInputElement.prototype.showPicker()` is supported in all current evergreen browsers (Chrome/Edge 99+, Firefox 101+, Safari 16.4+) and is the standard, spec-defined way to programmatically open a date input's picker — it's exactly what the browser already does internally when the user clicks the calendar icon. Wiring it to the whole field's click (instead of only relying on the icon) directly satisfies FR-001 without discarding the native-input decision or adding a dependency.

**Alternatives considered**:
- *Replace with a third-party calendar/date-picker library*: rejected — reintroduces the exact tradeoff (bundle size, a11y reimplementation, styling divergence from OS date pickers) the prior feature explicitly avoided; the actual problem (click target too small) doesn't require it.
- *CSS-only fix (`::-webkit-calendar-picker-indicator` stretched to fill the input)*: works in Chromium but is non-standard, WebKit/Blink-specific, and does nothing for Firefox; also silently fails instead of degrading gracefully.
- *`element.focus()` + simulate `Alt+Down` keypress*: unreliable — synthetic keyboard events aimed at triggering native browser chrome are not guaranteed to work and are considered a hack; `showPicker()` is the documented API for this exact purpose.

**Fallback**: If `showPicker` is unavailable (feature-detected via `'showPicker' in HTMLInputElement.prototype`) or throws (some browsers reject it outside a user gesture, or third-party-cookie-like restrictions), the click handler no-ops and the input's default behavior (typing directly, or clicking the native icon) is preserved unchanged — satisfying the spec's edge case about older browsers.

## 2. Editing a food log entry's grams and recomputing nutrients

**Decision**: On `PATCH /food/logs/:id`, re-resolve the entry's already-stored `sourceType`/`sourceRef` through the existing private `resolveNutrients()` helper in `FoodService` (already used by `createFoodLog`) to get fresh per-100g nutrients, then run the existing `calculateNutrientsForGrams()` with the new gram amount, and persist the recomputed `caloriesComputed`/`proteinComputed`/`carbsComputed`/`fatComputed` alongside the new `grams` (and `mealCategory` if changed).

**Rationale**: This exactly mirrors the existing `updateExercise()` pattern in `CalorieBalanceService` (load existing row scoped to `userId`, merge in only the provided fields, recompute the derived value, `update()`) — it reuses code already written and tested for `createFoodLog`, so no new nutrient-calculation logic is introduced. Re-resolving nutrients (rather than trusting stale computed values) keeps behavior correct if a `LOCAL` food item's per-100g values were edited after the log entry was created — though that path is not part of this feature's scope, reusing `resolveNutrients` costs nothing extra and avoids a second, divergent recompute path.

**Alternatives considered**:
- *Store per-100g nutrients redundantly on the log entry itself so edit doesn't need to re-resolve*: rejected as a schema change with no requirement driving it — spec doesn't ask for editing the food source, and `resolveNutrients` is already fast (single lookup/query) and already the source of truth.
- *Client-side recompute (send calories the client calculated) and just trust it*: rejected — server-side recomputation is the existing pattern (`createFoodLog` never trusts client-sent calories either) and keeps the server authoritative over derived data.

## 3. Ownership + not-found handling for edit/delete

**Decision**: Mirror `CalorieBalanceService.updateExercise`/`deleteExercise` exactly: `findFirst({ where: { id, userId } })` before any mutation; throw `NotFoundException` if nothing matches (covers both "doesn't exist" and "belongs to someone else" without leaking which case it is).

**Rationale**: Consistent with the codebase's existing authorization pattern for user-owned mutable resources, and satisfies FR-011 (users can only edit/delete their own entries) and the double-delete edge case (a second delete attempt on an already-removed row naturally 404s, which the frontend surfaces as "already removed").

**Alternatives considered**: A dedicated ownership guard/decorator — rejected as unnecessary abstraction for two call sites that already have a proven inline pattern one module over.

## 4. Scoping the Food Log page to a specific date from the Dashboard

**Decision**: Pass the date as a query parameter (`/food-log?date=YYYY-MM-DD`) via `react-router-dom`'s `Link`/`useSearchParams`, defaulting to today's date (in the account timezone) when absent — matching how `mode` is currently passed via router `state` for scan/voice/manual, but using a URL query param instead of state so the date survives a page refresh and is shareable/bookmarkable.

**Rationale**: `FoodLog.tsx` currently hardcodes `todayLocalDate()` for its `listFoodLogsForDay` call and has no concept of viewing a past day. The spec requires clicking a home-page item for a past date to land on that same date in the Food Log page (User Story 2, Acceptance Scenario 3). A query param is the simplest way to carry that one piece of state across navigation without adding global state (Zustand) for what is a single page's transient view parameter.

**Alternatives considered**:
- *Router `state` (like `mode` today)*: rejected — doesn't survive a manual URL visit/refresh, and the spec's acceptance criteria imply this should behave like a real, revisitable view of that day's log, not a one-shot transition.
- *Zustand global store for "currently viewed date"*: rejected as unnecessary global state for something scoped to one page's URL.
