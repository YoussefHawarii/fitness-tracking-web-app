# Egyptian food catalog import — source, corrections, and exclusions

## Source

[Egyptian Food dataset on Kaggle](https://www.kaggle.com/datasets/mernamohamed3/egyptian-food) — 470 food
items, sourced from the **National Nutrition Institute (Egypt)**, *Food Composition Tables for Egypt*, 2nd
edition (2006). Licensed **CC BY 4.0** (Attribution 4.0 International) — used here with credit to the
National Nutrition Institute, Egypt, per the license terms.

The source is English-only (`FOOD` column) with 21 nutrient columns. This app's `CanonicalFood` schema only
tracks calories/protein/carbs/fat per 100g, so the other columns (water, ash, fiber, sodium, potassium,
calcium, phosphorus, magnesium, iron, zinc, copper, vitamin A, vitamin C, thiamin, riboflavin) were not
imported. Arabic names and aliases (including Egyptian colloquial terms) were added by hand — the source
has none.

The user supplied the downloaded CSV directly (`Egyptian Food.csv`) after confirming they wanted the full
470-item dataset imported (not a smaller curated subset).

## File layout in this repo

The imported, corrected data lives in `Backend/prisma/egyptian-food-catalog.csv` — one row per food, with a
`category` column (Grains, Vegetables, Dairy, etc.) for browsing and a `notes` column carrying the per-item
reasoning referenced throughout this document (e.g. why two preparations of the same food share a search
alias). It's a plain CSV, so it can be opened and reviewed directly in Excel.

`Backend/prisma/egyptian-food-catalog.ts` is a thin loader, not the data itself — it reads and parses that
CSV at seed time into the `SeedFood[]` shape `Backend/prisma/seed.ts` expects, and throws a clear error if a
row is missing a required field or has a non-numeric nutrient value (a hand-edit safety net, since the CSV
is no longer type-checked by TypeScript the way the original array literal was).

## Data-quality check performed before import

Before writing any entries, a structural consistency check was run across all 470 rows: for each row,
`WATER + PROTEIN + FAT + ASH + CARBOHYDRATE` should sum to approximately 100 (since carbohydrate in this
kind of table is computed "by difference" — 100 minus everything else measured). A large deviation from
100 flags a likely data-entry or transcription error in that row.

## Rows excluded entirely

Three rows had corruption severe enough that no confident correction was possible, so they were dropped
rather than guessed at:

- **"Beef, Basterma meat"** — `CARBOHYDRATE = 1500` (g per 100g; impossible) and `ENERGY = 29.9` kcal
  (implausibly low for a cured meat product, compare "Beef, Basterma" in the same table at 201 kcal). Two
  separate corrupted values in the same row — low confidence in any reconstruction.
- The row transcribed as **"Beer. frankhurter"** (evidently "Beef, frankfurter") — one field short of the
  expected column count, consistent with a missing comma merging the `ENERGY` and `PROTEIN` values into a
  single field (`22415.2`).
- The row transcribed as **"iicet, meat rodnd"** (evidently "Beef, meat, round") — `PROTEIN = 118` (g per
  100g; impossible on its own terms, since no food is literally more than 100% protein by mass), on top of
  the garbled name.

## A 9-row block with a systematic error, corrected against live USDA data

Rows for **lupines, lupines (termis), peas, soybeans, soybeans flour, almonds, coconuts (dry), hazelnuts,
peanuts** all had `PROTEIN` and `FAT` values that were *identical* to each other — implausible for any of
these foods (e.g. real almonds are ~21g protein vs. ~50g fat per 100g, not equal), consistent with a
column copy-paste error affecting this contiguous block in the original transcription.

- **Almonds, coconut (dried), hazelnuts, peanuts, soybeans, soy flour, peas (dried)** — corrected against a
  live lookup against USDA FoodData Central (`api.nal.usda.gov`, public `DEMO_KEY`) during this session.
  Exact figures used are in `Backend/prisma/egyptian-food-catalog.csv` (see the `notes` column for each row).
- **Lupines / lupines (termis)** — excluded entirely. Both fields were corrupted (not just protein/fat —
  the water+protein+fat+ash+carb sum for the raw "lupines" row was only ~50, roughly half of what's
  expected), and the USDA lookup hit its rate limit before these two specific items could be verified.
  Better to omit than publish a guessed number in a health-tracking app; worth revisiting if a reliable
  source turns up.

## Other corrections during import

- **OCR/transcription typos in food names**: "Beer. burger" → "Beef, burger"; "Beet. meat" → "Beef, meat";
  "iicet, meat rodnd" (excluded, see above); "kunckle" → "knuckle"; "Iung" → "lung"; two dessert names with
  garbled/encoding-corrupted trailing characters ("Oriental Katait�" → Kataifi/قطايف, "Oriental Maamout�" →
  Ma'amoul/معمول).
- **3 apparent "duplicate" food names that are actually distinct foods**: the source used the bare name
  "cowpeas" for both a dry/raw entry and a separate fresh/green entry without distinguishing them (same for
  "peas" and "coriander" — dry/raw vs. fresh, and fresh-herb vs. dried-spice, respectively). Each pair was
  given a distinguishing name on import (e.g. "Cowpeas, dried, raw" vs. "Cowpeas, fresh").
- **"Tomatoes, roots"** — almost certainly a mistranslation in the original table (the nutrient profile —
  78 kcal, low fat, moderate carbs — matches concentrated tomato paste closely, not a root vegetable).
  Imported as "Tomato paste" (معجون طماطم) under that corrected identity.
- **Near-duplicate raw-grain and dish variants consolidated rather than imported 1:1** — e.g. "rice, grains
  (long)" and "rice, grains (short)" were both essentially raw white rice with a ~2% calorie difference;
  only one was kept, to avoid recreating the original "too many near-identical items" complaint this
  catalog exists to fix. Similarly for a few near-duplicate dish variants (e.g. "koshari" vs. "koshari,
  market", "chickpeas, yellow" vs. the main chickpeas entry).
- **Two irrelevant rows dropped**: "rice, fortified-baby food" and "wheat, fortified-baby food" (infant
  nutrition, out of scope for general adult food logging), "Milk, human" (breastfeeding-specific, same
  reasoning), and "Salt, table/cooking" / "Salt, sodium reduced" (no meaningful calorie/macro content; this
  app doesn't track sodium).

## Reconciliation with the pre-existing hand-built catalog

Before this import, the catalog had 20 hand-typed entries (added earlier in this project, with
USDA-typical *estimated* values, not sourced from this dataset). One of those 20 — "Rice, white, raw" —
had a direct match in this dataset (357 kcal) and was removed from the hand-built list entirely, fully
superseded by the imported `Grains` entry, to avoid a duplicate `nameEn`.

**Correction (caught in a later code review — see the review thread for 2026-09-14):** the remaining 13
hand-built entries were *not* actually updated from this dataset, despite an earlier version of this
document and several code comments in `Backend/prisma/seed.ts` claiming they were "updated in place to
National Nutrition Institute figures." Re-checking each one directly against
`Backend/prisma/egyptian-food-catalog.csv` found no matching row for any of them — the dataset simply
doesn't cover these foods in the generic form this app needs (e.g. it has specific beef cuts like liver,
kofta, and tongue, but no plain "beef"; egg white and egg yolk separately, but no combined "whole egg"; no
banana entry at all; no plain potato entry in any preparation). All 13 — Beef (raw & cooked), Eggs,
Baladi bread, Ful medames, Lentils, White cheese, Yogurt, Tomato, Cucumber, Potato (boiled, French fries,
pan-fried), and Apple — remain exactly what they always were: hand-estimated figures, same standing as
Chicken breast and Olive oil. The false comments in `seed.ts` have been corrected to say so.

## Ambiguity-preservation pattern applied throughout

Per the established fix for the original "chicken breast shows too many near-identical results" bug: for
any food with multiple preparation states that differ meaningfully in calories (e.g. raw vs. cooked, or
different cooking methods), the generic/unqualified name or alias is shared across all of them, so a bare
search surfaces every variant as a candidate instead of silently resolving to just one. This was applied
consistently across all new categories (e.g. okra raw/cooked/with-meat all share "بامية"; sardines
fresh/canned/grilled/salted all share "سردين"). Qualified searches (e.g. "grilled chicken breast") still
resolve to a single result on their own.
