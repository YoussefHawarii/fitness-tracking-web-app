import { isAxiosError } from 'axios';
import { apiClient } from './apiClient';

// Kept in sync by hand with Backend/src/modules/food/dto/create-food-log.dto.ts's
// FOOD_SOURCE_TYPES — this app has no shared package between Frontend and
// Backend, so it can't import that union directly.
export type FoodSourceType = 'OPEN_FOOD_FACTS' | 'USDA' | 'LOCAL' | 'CANONICAL';
// Search never resolves a barcode — a FoodMatch only ever comes from
// GET /food/search, which resolves the other three source types.
export type FoodMatchSourceType = Exclude<FoodSourceType, 'OPEN_FOOD_FACTS'>;
export type MealCategory = 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACKS';

export interface NutrientsPer100g {
  caloriesPer100g: number;
  proteinPer100g?: number | null;
  carbsPer100g?: number | null;
  fatPer100g?: number | null;
}

export interface OpenFoodFactsProduct extends NutrientsPer100g {
  name: string;
  barcode: string;
}

export interface LocalFoodItem extends NutrientsPer100g {
  id: string;
  name: string;
}

// A single search result, whichever of the three sources it came from —
// returned by the shared GET /food/search endpoint used by both Manual
// search and Voice. See docs/food-log-input-modes-diagnosis.md §3.4.
export interface FoodMatch extends NutrientsPer100g {
  sourceType: FoodMatchSourceType;
  sourceRef: string;
  name: string;
}

export type FoodSearchResult =
  | { type: 'single'; match: FoodMatch }
  | { type: 'candidates'; matches: FoodMatch[] }
  | { type: 'empty' };

// Thrown by lookupBarcode when the lookup couldn't be completed at all
// (network error, our own rate limit, an OFF outage, an auth failure) — as
// opposed to a confirmed "this barcode has no product," which resolves to
// null instead. Collapsing both into the same "not found" outcome was the
// bug: a rate-limited scan looked identical to a barcode OFF genuinely
// doesn't have. See docs/food-log-input-modes-diagnosis.md §1.3.
export class BarcodeLookupUnavailableError extends Error {
  constructor() {
    super('Barcode lookup could not be completed.');
    this.name = 'BarcodeLookupUnavailableError';
  }
}

export async function lookupBarcode(
  barcode: string,
): Promise<OpenFoodFactsProduct | null> {
  try {
    const { data } = await apiClient.get(
      `/food/barcode/${encodeURIComponent(barcode)}`,
    );
    return data;
  } catch (err) {
    if (isAxiosError(err) && err.response?.status === 404) {
      return null; // confirmed not found → caller falls through to manual entry
    }
    throw new BarcodeLookupUnavailableError();
  }
}

export async function searchFood(term: string): Promise<FoodSearchResult> {
  const { data } = await apiClient.get('/food/search', {
    params: { term },
  });
  return data;
}

export async function createLocalFoodItem(input: {
  name: string;
  caloriesPer100g: number;
  proteinPer100g?: number;
  carbsPer100g?: number;
  fatPer100g?: number;
}): Promise<LocalFoodItem> {
  const { data } = await apiClient.post('/food/local-items', input);
  return data;
}

export async function listLocalFoodItems(): Promise<LocalFoodItem[]> {
  const { data } = await apiClient.get('/food/local-items');
  return data;
}

export async function createFoodLog(input: {
  sourceType: FoodSourceType;
  sourceRef: string;
  // CANONICAL only — the display name already resolved by search, passed
  // through so history shows whichever language (EN/AR) the user searched in.
  name?: string;
  grams: number;
  mealCategory: MealCategory;
  loggedAtUtc: string;
}) {
  const { data } = await apiClient.post('/food/logs', input);
  return data;
}

export interface FoodLogEntry {
  id: string;
  sourceType: FoodSourceType;
  sourceRef: string;
  localFoodItemId: string | null;
  name: string;
  grams: string;
  caloriesComputed: string;
  proteinComputed: string | null;
  carbsComputed: string | null;
  fatComputed: string | null;
  mealCategory: MealCategory;
  loggedAtUtc: string;
}

export async function listFoodLogsForDay(
  date: string,
): Promise<FoodLogEntry[]> {
  const { data } = await apiClient.get('/food/logs', { params: { date } });
  return data;
}

export async function updateFoodLog(
  id: string,
  input: { grams?: number; mealCategory?: MealCategory },
): Promise<FoodLogEntry> {
  const { data } = await apiClient.patch(`/food/logs/${id}`, input);
  return data;
}

export async function deleteFoodLog(id: string): Promise<void> {
  await apiClient.delete(`/food/logs/${id}`);
}
