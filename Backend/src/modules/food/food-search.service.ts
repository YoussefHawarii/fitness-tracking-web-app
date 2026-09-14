import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UsdaClient } from './clients/usda.client';
import type { FoodSourceType } from './dto/create-food-log.dto';
import type { NutrientsPer100g } from './calorie-calculator';
import {
  matchCanonicalFoods,
  type CanonicalFoodRecord,
} from './canonical-food-matcher';

// Search never resolves a barcode — OPEN_FOOD_FACTS entries only ever come
// from the dedicated scan endpoint, not from GET /food/search.
export type FoodMatchSourceType = Exclude<FoodSourceType, 'OPEN_FOOD_FACTS'>;

export interface FoodMatch extends NutrientsPer100g {
  sourceType: FoodMatchSourceType;
  sourceRef: string;
  name: string;
}

export type FoodSearchResult =
  | { type: 'single'; match: FoodMatch }
  | { type: 'candidates'; matches: FoodMatch[] }
  | { type: 'empty' };

const MAX_CANDIDATES = 8;

// A natural-language transcript/sentence ("I had eggs and toast" / "أكلت
// صدر فراخ مشوي") often carries 1-2 filler words (a verb, a pronoun) before
// the actual food name that the exact/substring canonical matcher won't see
// through. Capped conservatively so an oddly-phrased but complete food name
// that genuinely matches nothing doesn't get stripped down into an unrelated
// accidental substring hit.
const MAX_LEADING_WORD_STRIPS = 2;

// Single search entry point shared by Manual search and Voice (both call
// GET /food/search) so an Arabic typed query and an Arabic transcribed query
// resolve identically — docs/food-log-input-modes-diagnosis.md §3.2/§3.4.
//
// Order: curated canonical catalog (bilingual, deterministic) -> the user's
// own private LocalFoodItems -> live USDA search as the long-tail fallback,
// unchanged from today's behavior (multiple raw candidates, no auto-select).
@Injectable()
export class FoodSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usda: UsdaClient,
  ) {}

  async search(term: string, userId: string): Promise<FoodSearchResult> {
    const trimmed = term.trim();
    if (!trimmed) return { type: 'empty' };

    // Canonical/local are cheap (in-memory match / a single indexed DB
    // query), so it's fine to retry them across leading-word-stripped
    // variants of the term. USDA is an external, rate-limited API — it
    // stays a single call with the original term, tried only once
    // everything else has failed, so this fallback can't multiply USDA
    // traffic per search.
    let candidate = trimmed;
    for (let strips = 0; strips <= MAX_LEADING_WORD_STRIPS; strips++) {
      const canonicalResult = await this.searchCanonical(candidate);
      if (canonicalResult) return canonicalResult;

      const localResult = await this.searchLocalItems(candidate, userId);
      if (localResult) return localResult;

      const words = candidate.split(/\s+/);
      if (words.length <= 1) break;
      candidate = words.slice(1).join(' ');
    }

    return this.searchUsdaFallback(trimmed);
  }

  private async searchCanonical(
    term: string,
  ): Promise<FoodSearchResult | null> {
    const rows = await this.prisma.canonicalFood.findMany();
    const records: CanonicalFoodRecord[] = rows.map((row) => ({
      id: row.id,
      nameEn: row.nameEn,
      nameAr: row.nameAr,
      aliasesEn: row.aliasesEn,
      aliasesAr: row.aliasesAr,
      caloriesPer100g: Number(row.caloriesPer100g),
      proteinPer100g: row.proteinPer100g ? Number(row.proteinPer100g) : null,
      carbsPer100g: row.carbsPer100g ? Number(row.carbsPer100g) : null,
      fatPer100g: row.fatPer100g ? Number(row.fatPer100g) : null,
    }));

    const matches = matchCanonicalFoods(term, records);
    if (matches.length === 0) return null;

    const exact = matches.filter((m) => m.exact);
    const chosen = exact.length > 0 ? exact : matches;

    const toFoodMatch = (m: (typeof matches)[number]): FoodMatch => ({
      sourceType: 'CANONICAL',
      sourceRef: m.food.id,
      name: m.displayName,
      caloriesPer100g: m.food.caloriesPer100g,
      proteinPer100g: m.food.proteinPer100g,
      carbsPer100g: m.food.carbsPer100g,
      fatPer100g: m.food.fatPer100g,
    });

    if (chosen.length === 1) {
      return { type: 'single', match: toFoodMatch(chosen[0]) };
    }
    return {
      type: 'candidates',
      matches: chosen.slice(0, MAX_CANDIDATES).map(toFoodMatch),
    };
  }

  private async searchLocalItems(
    term: string,
    userId: string,
  ): Promise<FoodSearchResult | null> {
    const rows = await this.prisma.localFoodItem.findMany({
      where: { userId, name: { contains: term, mode: 'insensitive' } },
      take: MAX_CANDIDATES,
    });
    if (rows.length === 0) return null;

    const toFoodMatch = (row: (typeof rows)[number]): FoodMatch => ({
      sourceType: 'LOCAL',
      sourceRef: row.id,
      name: row.name,
      caloriesPer100g: Number(row.caloriesPer100g),
      proteinPer100g: row.proteinPer100g ? Number(row.proteinPer100g) : null,
      carbsPer100g: row.carbsPer100g ? Number(row.carbsPer100g) : null,
      fatPer100g: row.fatPer100g ? Number(row.fatPer100g) : null,
    });

    if (rows.length === 1) {
      return { type: 'single', match: toFoodMatch(rows[0]) };
    }
    return { type: 'candidates', matches: rows.map(toFoodMatch) };
  }

  private async searchUsdaFallback(term: string): Promise<FoodSearchResult> {
    const results = await this.usda.searchByTerm(term);
    if (results.length === 0) return { type: 'empty' };
    return {
      type: 'candidates',
      matches: results.map((r) => ({
        sourceType: 'USDA',
        sourceRef: r.fdcId,
        name: r.name,
        caloriesPer100g: r.caloriesPer100g,
        proteinPer100g: r.proteinPer100g ?? null,
        carbsPer100g: r.carbsPer100g ?? null,
        fatPer100g: r.fatPer100g ?? null,
      })),
    };
  }
}
