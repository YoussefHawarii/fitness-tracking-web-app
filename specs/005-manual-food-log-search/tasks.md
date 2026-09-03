---

description: "Task list template for feature implementation"
---

# Tasks: Manual Food Log by Name Search

**Input**: Design documents from `/specs/005-manual-food-log-search/`

**Prerequisites**: [plan.md](plan.md) (required), [spec.md](spec.md) (required for user stories), [research.md](research.md), [data-model.md](data-model.md), [contracts/existing-food-endpoints.md](contracts/existing-food-endpoints.md), [quickstart.md](quickstart.md)

**Tests**: Not requested in the feature spec. This feature is frontend-only and verified via the manual browser scenarios in `quickstart.md` (per CLAUDE.md: UI changes are verified in the browser, not by an automated frontend test suite). No automated test tasks are included.

**Organization**: Tasks are grouped by user story (from spec.md: US1 = P1, US2 = P2, US3 = P3) to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Every task includes an exact file path

## Path Conventions

Web application per plan.md: `Frontend/src/...` for all code changes. `Backend/` is unchanged — no backend tasks in this feature.

---

## Phase 1: Setup

**Purpose**: Confirm the local environment can exercise the feature; no new dependencies or scaffolding beyond the one new file created in Phase 2.

- [X] T001 Confirm local dev setup works end-to-end before starting: `Backend/.env` has `USDA_API_KEY` set, `cd Backend && npm run start:dev` starts cleanly, and `cd Frontend && npm run dev` starts cleanly against it (per [quickstart.md](quickstart.md) Prerequisites). No file changes — this is a go/no-go check.

**Checkpoint**: Dev environment confirmed working; proceed to Foundational.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create the one shared file every user story below extends. No user story work can begin until this exists.

**⚠️ CRITICAL**: T002 must complete before any task in Phase 3, 4, or 5.

- [X] T002 Create the new feature component shell at `Frontend/src/features/manual-food-search/ManualFoodSearch.tsx`: a functional component with props `{ onMatchSelected: (match: UsdaFoodMatch) => void; onLocalItemCreated: (item: LocalFoodItem) => void }`, importing `searchUsda`, `createLocalFoodItem`, `type UsdaFoodMatch`, `type LocalFoodItem` from `../../services/foodService`, and `Input`, `FieldLabel` from `../../components/ui/Input` and `PrimaryButton`, `SecondaryButton` from `../../components/ui/Button` (mirroring the existing structure of `Frontend/src/features/voice-logger/VoiceLogger.tsx`). No search/selection logic yet — just the file, imports, and prop types, returning an empty `<div className="flex flex-col gap-3" />`.

**Checkpoint**: `ManualFoodSearch.tsx` exists and compiles (even though empty) — user story implementation can now begin.

---

## Phase 3: User Story 1 - Log a food by name without knowing its calories (Priority: P1) 🎯 MVP

**Goal**: Let the user type a food name, search it, pick a recognized match, enter grams, and save — with calories computed automatically and never typed by the user.

**Independent Test**: Switch to the Manual tab, search "banana", select a match, enter grams, save, and confirm the logged calories are computed automatically (no calorie field was ever shown).

### Implementation for User Story 1

- [X] T003 [US1] In `Frontend/src/features/manual-food-search/ManualFoodSearch.tsx`, add search UI: a text `Input` bound to local state `term`, and a `SecondaryButton` ("Search") that calls `searchUsda(term)`, storing the result in local state `matches: UsdaFoodMatch[] | null` and clearing any prior error/empty-state (mirror `VoiceLogger.tsx`'s `handleConfirm`, lines 68-81, adapted to a typed name instead of a transcript).
- [X] T004 [US1] In the same file, render the candidate list: when `matches` is a non-empty array, render each `UsdaFoodMatch` as a clickable button showing `{match.name} — {match.caloriesPer100g} kcal/100g`, calling `onMatchSelected(match)` on click (mirror `VoiceLogger.tsx` lines 100-114 exactly, same markup classes for visual consistency).
- [X] T005 [US1] In `Frontend/src/pages/FoodLog.tsx`, replace the `mode === 'manual'` block's free-text form (current lines 156-181: the "Food name" and "Calories per 100g" `Input`s and "Use this item" button) with `<ManualFoodSearch onMatchSelected={handleUsdaMatchSelected} onLocalItemCreated={handleLocalItemCreated} />`, reusing the existing `handleUsdaMatchSelected` (line 78-80) unchanged so a selected match sets `pendingItem` with `sourceType: 'USDA'` exactly as the voice tab already does. (`handleLocalItemCreated` is added in Phase 5 / T012 — reference it here as a no-op stub `() => {}` for now if Phase 5 hasn't run yet, then replace in T012.)
- [X] T006 [US1] In `Frontend/src/pages/FoodLog.tsx`, remove the now-unused manual-calorie state and handler superseded by T005: delete `manualName`, `manualCalories` state (lines 54-55) and `handleCreateManualItem` (lines 82-93).

**Checkpoint**: Manual entry now works end-to-end for any food recognized by USDA search, with automatically computed calories — this is the deliverable MVP. Foods with no match will show an empty candidate list with no fallback yet (added in Phase 5).

---

## Phase 4: User Story 2 - Choose which meal the logged item belongs to (Priority: P2)

**Goal**: Confirm the manual-entry path, once rewired in Phase 3, reaches the existing meal-category picker unchanged and saves/groups correctly by meal — since this behavior already exists for barcode/voice, this phase is primarily verification plus a safety-net fix if the rewiring in Phase 3 broke it.

**Independent Test**: Complete a manual entry (per US1), choose "Dinner", save, and confirm the item appears under the Dinner section of the food log with its calories included in the Dinner subtotal.

### Implementation for User Story 2

- [X] T007 [US2] In `Frontend/src/pages/FoodLog.tsx`, verify the existing `pendingItem` card (grams `Input` + meal `Select` + "Save entry" button, lines 184-209) renders and behaves identically when `pendingItem` was set from the manual tab (via T005) as it does today for barcode/voice — no `mode`-specific branching should exist in this block. If any is found, remove it so the save step is fully shared across all three entry modes.
- [X] T008 [US2] Manual verification: run [quickstart.md](quickstart.md) Scenario 1, repeating steps 1-8 three more times choosing Breakfast, Lunch, and Snacks respectively (in addition to Dinner already covered in Phase 3's checkpoint), confirming each entry lands in the correct meal section with the correct subtotal on `Frontend/src/pages/FoodLog.tsx`'s rendered food log.

**Checkpoint**: Meal-category selection is confirmed working end-to-end for manually-entered foods, matching barcode/voice behavior.

---

## Phase 5: User Story 3 - Fall back gracefully when a food isn't recognized (Priority: P3)

**Goal**: When a name search returns no matches, let the user still log the food via a self-supplied-calories fallback, without losing the grams/meal-category/save flow.

**Independent Test**: Search a made-up food name, confirm a "no match" message and fallback option appear, complete the fallback (name + calories), then finish logging via grams + meal category exactly as in US1.

### Implementation for User Story 3

- [X] T009 [US3] In `Frontend/src/features/manual-food-search/ManualFoodSearch.tsx`, add a "no results" state: when `searchUsda(term)` resolves to an empty array, show a message (e.g. "No matches found for '<term>'.") and a `SecondaryButton` ("Add as custom item") that toggles a local `showFallback` state to `true`.
- [X] T010 [US3] In the same file, implement the fallback form shown when `showFallback` is `true`: a "Food name" `Input` and a "Calories per 100g" `Input` (same fields as the old `FoodLog.tsx` manual form removed in T006), and a `PrimaryButton` ("Use this item") that calls `createLocalFoodItem({ name, caloriesPer100g: Number(caloriesPer100g) })`, then calls `onLocalItemCreated(item)` with the created `LocalFoodItem` on success. Validate that name is non-empty and `caloriesPer100g` parses as a number before enabling the button, mirroring the old `handleCreateManualItem` validation (was `FoodLog.tsx` lines 82-93).
- [X] T011 [US3] In `Frontend/src/pages/FoodLog.tsx`, add `handleLocalItemCreated(item: LocalFoodItem)` that sets `pendingItem` to `{ sourceType: 'LOCAL', sourceRef: item.id, name: item.name }` (same shape the old `handleCreateManualItem` produced), and pass it as the real `onLocalItemCreated` prop to `<ManualFoodSearch />` from T005 (replacing the temporary no-op stub).
- [X] T012 [US3] Manual verification: run [quickstart.md](quickstart.md) Scenario 2 (fallback path) and Scenario 3 (invalid grams rejected) end-to-end in the browser.

**Checkpoint**: All three user stories are independently functional — recognized foods, meal-category grouping, and the unrecognized-food fallback all work.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Confirm no regressions and no leftover dead code from the rewiring.

- [X] T013 [P] Run `cd Frontend && npm run lint` and `cd Frontend && npm run build` to confirm no type or lint errors were introduced across `Frontend/src/pages/FoodLog.tsx` and `Frontend/src/features/manual-food-search/ManualFoodSearch.tsx`.
- [X] T014 Run [quickstart.md](quickstart.md) Scenario 4 (barcode + voice regression check) to confirm FR-011 — the barcode and voice entry paths in `Frontend/src/pages/FoodLog.tsx` still work unchanged after this feature's edits.
- [X] T015 [P] Review `Frontend/src/pages/FoodLog.tsx` and `Frontend/src/features/manual-food-search/ManualFoodSearch.tsx` for now-unused imports or leftover references to the removed `manualName`/`manualCalories`/`handleCreateManualItem` (from T006), and remove them.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Phase 1. T002 BLOCKS all of Phase 3, 4, and 5.
- **User Story 1 (Phase 3)**: Depends on Phase 2 (T002). Independent of US2/US3 beyond that.
- **User Story 2 (Phase 4)**: Depends on Phase 3 (T005) having wired the manual tab into the shared `pendingItem` flow — T007/T008 verify that flow. Cannot be meaningfully tested before US1 exists.
- **User Story 3 (Phase 5)**: Depends on Phase 2 (T002) for the component shell and on T005 (US1) existing so `onLocalItemCreated` has somewhere to plug in (T011). Can be implemented in parallel with Phase 4 by a different developer, since it touches the "no results" branch while Phase 4 touches the "match selected" branch.
- **Polish (Phase 6)**: Depends on Phases 3, 4, and 5 all being complete.

### Within Each User Story

- Phase 3: T003 and T004 both edit `ManualFoodSearch.tsx` sequentially (same file) → then T005 wires it into `FoodLog.tsx` → then T006 cleans up `FoodLog.tsx`.
- Phase 4: T007 (verify/fix) → T008 (manual test), sequential.
- Phase 5: T009 and T010 both edit `ManualFoodSearch.tsx` sequentially → T011 edits `FoodLog.tsx` → T012 manual test.

### Parallel Opportunities

- T013 and T015 in Phase 6 touch different concerns (build/lint vs. code review) and can run in parallel.
- Phase 4 and Phase 5 can be worked on by two different developers in parallel once Phase 3 (T005) lands, since they touch different branches of the same component's behavior (matched vs. no-match) — but both edit `ManualFoodSearch.tsx` and `FoodLog.tsx`, so in practice coordinate merges if done simultaneously by different people.
- No tasks within Phase 2 or Phase 3 are parallelizable — they form a single sequential chain through the same two files.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (T001) and Phase 2 (T002).
2. Complete Phase 3 (T003-T006).
3. **STOP and VALIDATE**: Run quickstart.md Scenario 1 for a recognized food. This alone already fixes the core complaint (no more typing calories manually).
4. Demo if ready — meal-category choice already works at this point too (it was never broken), so Phase 4's tasks are mostly confirmation, not new risk.

### Incremental Delivery

1. Setup + Foundational → shell ready.
2. Add User Story 1 → validate → this is the MVP fixing the primary complaint.
3. Add User Story 2 → validate meal grouping across all four categories.
4. Add User Story 3 → validate the no-match fallback still works for unusual foods.
5. Polish → confirm no regressions to barcode/voice, clean up dead code.

## Notes

- This feature is small and touches exactly two files (`Frontend/src/pages/FoodLog.tsx`, new `Frontend/src/features/manual-food-search/ManualFoodSearch.tsx`) plus zero backend files — most tasks are sequential edits to those two files rather than parallel work.
- No automated tests were requested or added; every story's "Independent Test" is a manual browser scenario from quickstart.md, consistent with CLAUDE.md's guidance to verify frontend/UI changes in the browser.
- Commit after each checkpoint (end of each phase) to keep history reviewable.
