# Phase 0 Research: Manual Food Log by Name Search

No `[NEEDS CLARIFICATION]` markers remained in the spec, and the Technical Context in [plan.md](plan.md) has no open unknowns. This document records the codebase investigation that made that possible — confirming reasonable defaults are backed by real, working code rather than assumption.

## Decision: Reuse the existing USDA search endpoint for name-based food recognition

- **Decision**: The manual-entry "recognize this food by name" requirement (FR-001–FR-003) is satisfied entirely by the existing `GET /food/search-usda?term=` endpoint (`Backend/src/modules/food/food.controller.ts:34`, `food.service.ts:27`), already exposed to the frontend as `searchUsda()` (`Frontend/src/services/foodService.ts:37`).
- **Rationale**: This endpoint is already live in production use for the voice-logging path (`VoiceLogger.tsx`) — it returns `UsdaFoodMatch[]` with `name` and `caloriesPer100g` per match, which is exactly the shape FR-003 requires. Reusing it means zero backend risk and consistent calorie data across every entry path (barcode, voice, manual).
- **Alternatives considered**: Building a second/different food database or search index for manual entry was rejected — it would fragment calorie data sources (a food logged via voice vs. manual could disagree on calories) and duplicate work the backend already does correctly.

## Decision: Reuse the existing search-then-select UI pattern from `VoiceLogger.tsx`

- **Decision**: The manual tab will use the same pattern already implemented in `VoiceLogger.tsx` (lines 68–116): submit a search term, receive a list of `UsdaFoodMatch`, render them as selectable candidates, and call a single `onMatchSelected` callback when the user picks one.
- **Rationale**: `FoodLog.tsx` already has a slot for this — `handleUsdaMatchSelected` (`FoodLog.tsx:78-80`) exists and is currently wired only to the voice tab. The manual tab needs a component with the same shape (a search box + candidate list) feeding the same handler, so the existing `pendingItem` → grams → meal-category → save flow (`FoodLog.tsx:184-209`) does not need to change at all.
- **Alternatives considered**: Auto-selecting the top search result instead of presenting a list was rejected per spec's Edge Cases (ambiguous common ingredients need user disambiguation) and matches the precedent already set by voice logging (its code comment explicitly notes candidates are "presented rather than auto-selected").

## Decision: Reuse the existing `LOCAL` food-item flow as the no-match fallback

- **Decision**: FR-008/FR-009's fallback path (self-supplied calories when no match is found) is satisfied by the existing `createLocalFoodItem` + `LOCAL` sourceType machinery, already fully implemented end-to-end in `food.service.ts` (`resolveNutrients`, the `LOCAL` branch) and already what today's manual-entry form (pre-change) produces.
- **Rationale**: No new backend capability is needed — the current manual-entry code (`FoodLog.tsx:82-93`, `handleCreateManualItem`) already does exactly this. The only change is *when* it's offered: today it's the only manual option; after this feature, it's offered only after a search returns zero matches.
- **Alternatives considered**: Removing the self-supplied-calorie path entirely was rejected — it's needed as a safety net for foods (e.g., homemade dishes) that will never appear in USDA's database, per spec Edge Cases and Assumptions.

## Decision: No backend changes required

- **Decision**: This feature ships as a frontend-only change.
- **Rationale**: Verified by reading `Backend/src/modules/food/food.controller.ts`, `food.service.ts`, `calorie-calculator.ts`, `dto/create-food-log.dto.ts`, and `dto/create-local-food-item.dto.ts` — every DTO, endpoint, and calculation this feature needs already exists and is exercised today by the barcode/voice paths. Meal-category selection and persistence (FR-006, FR-007) is also already implemented in `FoodLog.tsx`'s shared `pendingItem` save step and in `CreateFoodLogDto.mealCategory` — it is not currently gated to any particular source type.
- **Alternatives considered**: N/A — this is a factual finding, not a design choice.

## Resolved unknowns

None remain. All Technical Context fields in plan.md are filled from direct codebase inspection, not assumption.
