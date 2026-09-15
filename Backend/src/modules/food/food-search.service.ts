import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UsdaClient } from './clients/usda.client';
import type { FoodSourceType } from './dto/create-food-log.dto';
import type { NutrientsPer100g } from './calorie-calculator';
import {
  matchCanonicalFoods,
  normalizeTerm,
  tokenizeFoodTranscript,
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

export type RecognizedFoodSearchResult = Exclude<
  FoodSearchResult,
  { type: 'empty' }
>;

export interface TranscriptSearchResult {
  groups: Array<{ term: string; result: RecognizedFoodSearchResult }>;
}

interface LocalFoodRecord extends NutrientsPer100g {
  id: string;
  name: string;
}

const MAX_CANDIDATES = 8;
const MAX_TRANSCRIPT_SPAN_WORDS = 7;

// A natural-language transcript/sentence ("I had eggs and toast" / "أكلت
// صدر فراخ مشوي") often carries 1-2 filler words (a verb, a pronoun) before
// the actual food name that the exact/substring canonical matcher won't see
// through. Capped conservatively so an oddly-phrased but complete food name
// that genuinely matches nothing doesn't get stripped down into an unrelated
// accidental substring hit.
const MAX_LEADING_WORD_STRIPS = 2;

// Single-term search entry point used by Manual search. Voice transcripts use
// the catalog-guided searchTranscript method below.
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

  async searchTranscript(
    transcript: string,
    userId: string,
  ): Promise<TranscriptSearchResult> {
    const words = tokenizeFoodTranscript(transcript);
    if (words.length === 0) return { groups: [] };

    const [catalog, localItems] = await Promise.all([
      this.loadCanonicalFoods(),
      this.loadLocalItems(userId),
    ]);
    const groups: TranscriptSearchResult['groups'] = [];

    let wordIndex = 0;
    while (wordIndex < words.length) {
      const maxSpanLength = Math.min(
        MAX_TRANSCRIPT_SPAN_WORDS,
        words.length - wordIndex,
      );
      let recognized: TranscriptSearchResult['groups'][number] | null = null;
      let recognizedLength = 0;

      for (let length = maxSpanLength; length >= 1; length--) {
        const term = words.slice(wordIndex, wordIndex + length).join(' ');
        const match = this.matchTranscriptSpan(term, catalog, localItems);

        if (match) {
          recognized = match;
          recognizedLength = length;
          break;
        }
      }

      if (recognized) {
        groups.push(recognized);
        wordIndex += recognizedLength;
      } else {
        wordIndex++;
      }
    }

    return { groups };
  }

  private matchTranscriptSpan(
    term: string,
    catalog: CanonicalFoodRecord[],
    localItems: LocalFoodRecord[],
  ): TranscriptSearchResult['groups'][number] | null {
    const result =
      this.matchCanonicalTranscriptSpan(term, catalog) ??
      this.matchLocalItemsExact(term, localItems);
    if (result) return { term, result };

    // Arabic speech-to-text commonly attaches the conjunction waw to the
    // following word ("ورز" for "و رز"). Preserve a legitimate waw-initial
    // food by trying the original span first, and only retry without one
    // leading waw when the unstripped span has no catalog or local match.
    if (!term.startsWith('و')) return null;
    const wawStrippedTerm = term.slice(1).trimStart();
    if (!wawStrippedTerm) return null;

    const wawStrippedResult =
      this.matchCanonicalTranscriptSpan(wawStrippedTerm, catalog) ??
      this.matchLocalItemsExact(wawStrippedTerm, localItems);
    return wawStrippedResult
      ? { term: wawStrippedTerm, result: wawStrippedResult }
      : null;
  }

  private async searchCanonical(
    term: string,
  ): Promise<FoodSearchResult | null> {
    return this.matchCanonicalFoods(term, await this.loadCanonicalFoods());
  }

  private async loadCanonicalFoods(): Promise<CanonicalFoodRecord[]> {
    const rows = await this.prisma.canonicalFood.findMany();
    return rows.map((row) => ({
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
  }

  private async loadLocalItems(userId: string): Promise<LocalFoodRecord[]> {
    const rows = await this.prisma.localFoodItem.findMany({
      where: { userId },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      caloriesPer100g: Number(row.caloriesPer100g),
      proteinPer100g:
        row.proteinPer100g == null ? null : Number(row.proteinPer100g),
      carbsPer100g: row.carbsPer100g == null ? null : Number(row.carbsPer100g),
      fatPer100g: row.fatPer100g == null ? null : Number(row.fatPer100g),
    }));
  }

  private matchCanonicalFoods(
    term: string,
    records: CanonicalFoodRecord[],
  ): FoodSearchResult | null {
    return this.toCanonicalSearchResult(matchCanonicalFoods(term, records));
  }

  private matchCanonicalTranscriptSpan(
    term: string,
    records: CanonicalFoodRecord[],
  ): RecognizedFoodSearchResult | null {
    // Typed search intentionally supports partial terms. Transcript filler
    // must not become an accidental substring hit against a catalog name.
    const exactMatches = matchCanonicalFoods(term, records).filter(
      (match) => match.exact,
    );
    return this.toCanonicalSearchResult(exactMatches);
  }

  private matchLocalItemsExact(
    term: string,
    records: LocalFoodRecord[],
  ): RecognizedFoodSearchResult | null {
    const normalizedTerm = normalizeTerm(term);
    if (!normalizedTerm) return null;

    const matches = records
      .filter((record) => normalizeTerm(record.name) === normalizedTerm)
      .slice(0, MAX_CANDIDATES);
    if (matches.length === 0) return null;

    const toFoodMatch = (record: LocalFoodRecord): FoodMatch => ({
      sourceType: 'LOCAL',
      sourceRef: record.id,
      name: record.name,
      caloriesPer100g: record.caloriesPer100g,
      proteinPer100g: record.proteinPer100g,
      carbsPer100g: record.carbsPer100g,
      fatPer100g: record.fatPer100g,
    });

    if (matches.length === 1) {
      return { type: 'single', match: toFoodMatch(matches[0]) };
    }
    return { type: 'candidates', matches: matches.map(toFoodMatch) };
  }

  private toCanonicalSearchResult(
    matches: ReturnType<typeof matchCanonicalFoods>,
  ): RecognizedFoodSearchResult | null {
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
  ): Promise<RecognizedFoodSearchResult | null> {
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
