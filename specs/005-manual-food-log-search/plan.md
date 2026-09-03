# Implementation Plan: Manual Food Log by Name Search

**Branch**: `005-manual-food-log-search` | **Date**: 2026-08-31 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-manual-food-log-search/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Replace the food-log page's manual-entry tab (free-text name + manually-typed calories) with a name-search-and-select flow: the user types a food name, the app searches the existing USDA lookup, the user picks a match from the results (calories computed automatically from that match's calorie density), enters grams, chooses a meal category, and saves. When no match is found, the user falls back to the existing self-supplied-calorie ("local item") path. Investigation of the backend (`Backend/src/modules/food/*`) confirms every capability this needs — USDA search, USDA-sourced food logs, local-item fallback, meal-category persistence, and calorie computation from per-100g density — already exists and works end-to-end for the voice-logging path. This is a **frontend-only** change: rewire `FoodLog.tsx`'s manual tab to reuse the same search-select pattern `VoiceLogger.tsx` already implements, instead of its current free-text calorie form. No backend, DTO, or schema changes are required.

## Technical Context

**Language/Version**: TypeScript 5 (React 19), matching the rest of `Frontend/`

**Primary Dependencies**: Existing `Frontend/src/services/foodService.ts` (`searchUsda`, `createLocalFoodItem`, `createFoodLog`), no new dependencies

**Storage**: N/A for this feature — reuses existing Postgres tables (`LocalFoodItem`, `FoodLogEntry`) via the existing backend endpoints; no schema changes

**Testing**: Frontend: manual browser verification via the dev server (no existing frontend test runner is wired into `Frontend/package.json` beyond `tsc`/`eslint`); Backend: unchanged, so no new backend tests are needed — existing `*.spec.ts`/`*.e2e-spec.ts` coverage for `/food/*` endpoints continues to apply unmodified

**Target Platform**: Web browser (existing Vite/React frontend), talking to the existing NestJS backend

**Project Type**: Web application (`Frontend/` + `Backend/`, per CLAUDE.md) — this feature only touches `Frontend/`

**Performance Goals**: Matches existing USDA search latency already experienced in the voice-logging path today; no new performance target

**Constraints**: Must not change any backend contract, DTO, or Prisma schema; must not regress the barcode or voice entry paths (FR-011)

**Scale/Scope**: Single page (`Frontend/src/pages/FoodLog.tsx`), one existing feature component pattern reused (`Frontend/src/features/voice-logger/VoiceLogger.tsx`); no new routes, pages, or backend modules

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is an unfilled placeholder template (confirmed in CLAUDE.md) — it defines no ratified principles or gates to check against. This gate is treated as **N/A / pass by default**.

**Post-Phase 1 re-check**: No change. Phase 1 design (data-model.md, contracts/, quickstart.md) confirmed zero new entities, zero new/changed endpoints, and zero schema changes — still N/A / pass.

## Project Structure

### Documentation (this feature)

```text
specs/005-manual-food-log-search/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
Frontend/
└── src/
    ├── pages/
    │   └── FoodLog.tsx                     # MODIFY: manual tab rewired to search-select flow
    ├── features/
    │   ├── voice-logger/
    │   │   └── VoiceLogger.tsx             # REFERENCE ONLY: existing search-select pattern to mirror
    │   └── manual-food-search/             # NEW: small feature folder for the manual-entry search UI,
    │       └── ManualFoodSearch.tsx        #      mirroring voice-logger's shape (kept out of FoodLog.tsx
    │                                       #      to match the existing barcode/voice feature-folder split)
    └── services/
        └── foodService.ts                  # UNCHANGED: searchUsda, createLocalFoodItem, createFoodLog
                                              #   already cover every call this feature needs

Backend/
└── src/modules/food/                       # UNCHANGED — no backend work in this feature
    ├── food.controller.ts                  #   /food/search-usda, /food/local-items, /food/logs
    ├── food.service.ts                     #   already resolves USDA/LOCAL sources and computes calories
    └── calorie-calculator.ts               #   already scales per-100g nutrients by grams
```

**Structure Decision**: Web application per CLAUDE.md (`Frontend/` + `Backend/`, deployed separately). This feature is scoped entirely to `Frontend/`: a new small component (`ManualFoodSearch.tsx`) under `Frontend/src/features/`, following the same one-feature-per-folder convention already used for `barcode-scanner/` and `voice-logger/`, wired into the existing `manual` tab of `FoodLog.tsx`. No `Backend/` files change.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations — Constitution Check is N/A (placeholder constitution, no gates defined), and this feature adds one small frontend component reusing existing backend contracts rather than new complexity.
