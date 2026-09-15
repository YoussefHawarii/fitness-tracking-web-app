// Pure text-normalization and matching logic for the curated bilingual food
// catalog (CanonicalFood). Kept dependency-free (no Prisma/Nest) so it's
// trivial to unit test — see docs/food-log-input-modes-diagnosis.md §3.2.

export interface CanonicalFoodRecord {
  id: string;
  nameEn: string;
  nameAr: string;
  aliasesEn: string[];
  aliasesAr: string[];
  caloriesPer100g: number;
  proteinPer100g: number | null;
  carbsPer100g: number | null;
  fatPer100g: number | null;
}

export interface CanonicalMatch {
  food: CanonicalFoodRecord;
  // The name to show the user — whichever script (EN/AR) their query used.
  displayName: string;
  exact: boolean;
}

const ARABIC_BLOCK = /[؀-ۿ]/;
const ARABIC_DIACRITICS = /[ً-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;
const INVISIBLE_TEXT_CONTROLS = /[\u200B-\u200F]/g;
const NON_BREAKING_SPACE = /\u00A0/g;
const COMMA_SEPARATORS = /[,،]/g;

export function containsArabic(text: string): boolean {
  return ARABIC_BLOCK.test(text);
}

function normalizeSpacingCharacters(text: string): string {
  return text
    .replace(INVISIBLE_TEXT_CONTROLS, ' ')
    .replace(NON_BREAKING_SPACE, ' ')
    .replace(COMMA_SEPARATORS, ' ');
}

// Strips tashkeel/tatweel, folds the common alef/ya/ta-marbuta spelling
// variants Egyptian Arabic input carries (إ/أ/آ/ا all typed for the same
// sound; ى vs ي; ة vs ه), drops the definite article "ال" prefix from each
// word (so "فراخ" and "الفراخ" normalize the same — very common in natural
// speech, e.g. "الفراخ" for "the chicken"), and drops stray punctuation
// (mirroring normalizeLatin) so "فراخ؟" still matches "فراخ".
export function normalizeArabic(text: string): string {
  return normalizeSpacingCharacters(text)
    .replace(ARABIC_DIACRITICS, '')
    .replace(TATWEEL, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/(^|\s)ال(?=\S)/gu, '$1')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeLatin(text: string): string {
  return normalizeSpacingCharacters(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTerm(text: string): string {
  return containsArabic(text) ? normalizeArabic(text) : normalizeLatin(text);
}

export function tokenizeFoodTranscript(text: string): string[] {
  const normalized = normalizeTerm(text);
  return normalized ? normalized.split(' ') : [];
}

interface Candidate {
  text: string;
  normalized: string;
}

function candidatesFor(food: CanonicalFoodRecord): Candidate[] {
  return [
    { text: food.nameEn, normalized: normalizeLatin(food.nameEn) },
    { text: food.nameAr, normalized: normalizeArabic(food.nameAr) },
    ...food.aliasesEn.map((a) => ({ text: a, normalized: normalizeLatin(a) })),
    ...food.aliasesAr.map((a) => ({ text: a, normalized: normalizeArabic(a) })),
  ].filter((c) => c.normalized.length > 0);
}

/**
 * Matches a search term against the canonical catalog. Returns every food
 * with at least one exact or substring hit against its name/aliases in
 * either language, sorted exact-matches-first. Caller decides how to turn
 * this into "single result" vs "candidates" (see FoodSearchService) since
 * that decision also weighs local items and the USDA fallback.
 */
export function matchCanonicalFoods(
  term: string,
  foods: CanonicalFoodRecord[],
): CanonicalMatch[] {
  const normalizedTerm = normalizeTerm(term);
  if (!normalizedTerm) return [];
  const queryIsArabic = containsArabic(term);

  const matches: CanonicalMatch[] = [];
  for (const food of foods) {
    let best: { exact: boolean } | null = null;
    for (const candidate of candidatesFor(food)) {
      if (candidate.normalized === normalizedTerm) {
        best = { exact: true };
        break;
      }
      // Only "candidate contains term" (a partial/prefix search, e.g. typing
      // "chick" finds "chicken breast") — deliberately NOT the reverse. A
      // short generic alias like "chicken" would otherwise substring-match
      // any longer query that happens to contain that word ("chicken
      // breast"), making an unambiguous search look falsely ambiguous.
      if (!best && candidate.normalized.includes(normalizedTerm)) {
        best = { exact: false };
      }
    }
    if (best) {
      matches.push({
        food,
        displayName: queryIsArabic ? food.nameAr : food.nameEn,
        exact: best.exact,
      });
    }
  }

  return matches.sort((a, b) => Number(b.exact) - Number(a.exact));
}
