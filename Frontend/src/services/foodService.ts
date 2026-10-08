import { isAxiosError } from 'axios';
import { apiClient } from './apiClient';

// Kept in sync by hand with Backend/src/modules/food/dto/create-food-log.dto.ts's
// FOOD_SOURCE_TYPES — this app has no shared package between Frontend and
// Backend, so it can't import that union directly.
export type FoodSourceType =
  'OPEN_FOOD_FACTS' | 'USDA' | 'LOCAL' | 'CANONICAL' | 'PACKAGED_PRODUCT';
// Search never resolves a barcode — a FoodMatch only ever comes from the
// single-term or transcript search endpoints.
export type FoodMatchSourceType = Exclude<
  FoodSourceType,
  'OPEN_FOOD_FACTS' | 'PACKAGED_PRODUCT'
>;
export type MealCategory = 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACKS';
export type BaseUnit = 'G' | 'ML';
export type PortionKind = 'PACKAGE' | 'SERVING' | 'CUSTOM';
export type ContainerKey = 'PACKAGE' | 'CAN' | 'BOTTLE' | 'JAR' | 'BOX' | 'BAG';
export type PortionDimension = 'MASS' | 'VOLUME' | 'UNKNOWN';
export type NutritionBasis = 'PER_100_G' | 'PER_100_ML';
export type NotLoggableReason =
  | 'NUTRITION_MISSING'
  | 'DIMENSION_BASIS_CONFLICT'
  | 'PORTION_DIMENSION_UNKNOWN'
  | 'NUTRITION_BASIS_UNKNOWN';
export type EffectiveNutritionBasis =
  | {
      basis: NutritionBasis;
      origin: 'DECLARED';
    }
  | {
      basis: NutritionBasis;
      origin: 'INFERRED';
      source: 'OPEN_FOOD_FACTS' | 'USER_SUBMITTED' | 'ADMIN';
      ruleId:
        | 'OPEN_FOOD_FACTS_PORTION_DIMENSION'
        | 'LEGACY_USER_SUBMITTED_MASS_GRANDFATHERING';
    };
export type BarcodeResolution =
  | {
      outcome: 'LOGGABLE';
      portionDimension: Exclude<PortionDimension, 'UNKNOWN'>;
      effectiveNutritionBasis: EffectiveNutritionBasis;
      package: { size: number; baseUnit: BaseUnit } | null;
      serving: { size: number; baseUnit: BaseUnit } | null;
      containerKey: ContainerKey;
    }
  | {
      outcome: 'NOT_LOGGABLE';
      display: {
        name: string;
        brand: string | null;
        imageUrl: string | null;
      };
      subjectKind: 'PACKAGED_PRODUCT' | 'IDENTIFIED_NOT_CATALOGUED';
      primaryReason: NotLoggableReason;
    };

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

export interface PackagedProduct {
  id: string;
  barcode: string;
  name: string;
  nameAr: string | null;
  brand: string | null;
  category: string | null;
  servingSize: number | null;
  servingBaseUnit: BaseUnit | null;
  packageSize: number | null;
  packageBaseUnit: BaseUnit | null;
  containerKey?: ContainerKey | null;
  caloriesPer100g: number;
  proteinPer100g: number | null;
  carbsPer100g: number | null;
  fatPer100g: number | null;
  fiberPer100g: number | null;
  sugarPer100g: number | null;
  sodiumPer100g: number | null;
  imageUrl: string | null;
  country: string | null;
  source: 'OPEN_FOOD_FACTS' | 'USER_SUBMITTED' | 'ADMIN';
  verificationStatus: 'UNVERIFIED' | 'EXTERNAL' | 'VERIFIED';
  resolution?: BarcodeResolution;
}

export interface IdentifiedBarcodeLookup {
  barcode: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  resolution: Extract<BarcodeResolution, { outcome: 'NOT_LOGGABLE' }> & {
    subjectKind: 'IDENTIFIED_NOT_CATALOGUED';
    primaryReason: 'NUTRITION_MISSING';
  };
}

export type BarcodeLookupResult = PackagedProduct | IdentifiedBarcodeLookup;

export interface LocalFoodItem extends NutrientsPer100g {
  id: string;
  name: string;
}

// A single search result, whichever of the three searchable sources it came
// from.
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

export class InvalidBarcodeError extends Error {
  constructor() {
    super('The scanned barcode failed validation.');
    this.name = 'InvalidBarcodeError';
  }
}

export async function lookupBarcode(
  barcode: string,
): Promise<BarcodeLookupResult | null> {
  try {
    const { data } = await apiClient.get(
      `/food/barcode/${encodeURIComponent(barcode)}`,
    );
    return data;
  } catch (err) {
    if (isAxiosError(err) && err.response?.status === 404) {
      return null; // confirmed not found → caller falls through to manual entry
    }
    if (isAxiosError(err) && err.response?.status === 400) {
      throw new InvalidBarcodeError();
    }
    throw new BarcodeLookupUnavailableError();
  }
}

export async function getPackagedProduct(id: string): Promise<PackagedProduct> {
  const { data } = await apiClient.get(
    `/food/products/${encodeURIComponent(id)}`,
  );
  return data;
}

export async function searchFood(term: string): Promise<FoodSearchResult> {
  const { data } = await apiClient.get('/food/search', {
    params: { term },
  });
  return data;
}

export async function searchFoodTranscript(
  transcript: string,
): Promise<TranscriptSearchResult> {
  const { data } = await apiClient.get('/food/search-transcript', {
    params: { transcript },
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

type CreateFoodLogBase = {
  sourceType: FoodSourceType;
  sourceRef: string;
  // CANONICAL only — the display name already resolved by search, passed
  // through so history shows whichever language (EN/AR) the user searched in.
  name?: string;
  mealCategory: MealCategory;
  loggedAtUtc: string;
};

export type CreateFoodLogInput = CreateFoodLogBase & {
  amount: number;
  amountUnit: BaseUnit;
  portionKind?: PortionKind;
  portionMultiplier?: number;
};

export async function createFoodLog(input: CreateFoodLogInput) {
  const { data } = await apiClient.post('/food/logs', input);
  return data;
}

export interface FoodLogEntry {
  id: string;
  sourceType: FoodSourceType;
  sourceRef: string;
  localFoodItemId: string | null;
  packagedProductId?: string | null;
  name: string;
  amount: string;
  amountUnit: BaseUnit;
  portionKind?: PortionKind | null;
  portionMultiplier?: string | null;
  caloriesComputed: string;
  proteinComputed: string | null;
  carbsComputed: string | null;
  fatComputed: string | null;
  mealCategory: MealCategory;
  loggedAtUtc: string;
}

export function getEntryDisplayAmount(entry: {
  amount: string | number;
}): string | number {
  return entry.amount;
}

// G entries retain the existing whole-gram display. ML entries expose their
// stored Base unit and preserve the supported one-decimal input precision.
export function formatEntryAmount(entry: {
  amount: string | number;
  amountUnit: BaseUnit;
}): string {
  const value = Number(getEntryDisplayAmount(entry) ?? 0);
  if (entry.amountUnit === 'ML') {
    const displayed = Number.isInteger(value)
      ? value.toFixed(0)
      : value.toFixed(1);
    return `${displayed} ml`;
  }
  return `${value.toFixed(0)} g`;
}

// Exact string FoodLog's startEdit puts in the edit input.
export function getEditPrefill(entry: { amount: string | number }): string {
  return String(getEntryDisplayAmount(entry));
}

export async function listFoodLogsForDay(
  date: string,
): Promise<FoodLogEntry[]> {
  const { data } = await apiClient.get('/food/logs', { params: { date } });
  return data;
}

export async function updateFoodLog(
  id: string,
  input:
    | { mealCategory: MealCategory }
    | {
        amount: number;
        amountUnit: BaseUnit;
        portionKind?: PortionKind;
        portionMultiplier?: number;
        mealCategory: MealCategory;
      },
): Promise<FoodLogEntry> {
  const { data } = await apiClient.patch(`/food/logs/${id}`, input);
  return data;
}

export async function deleteFoodLog(id: string): Promise<void> {
  await apiClient.delete(`/food/logs/${id}`);
}

export class ProductConflictError extends Error {
  constructor() {
    super('A product with this barcode already exists.');
    this.name = 'ProductConflictError';
  }
}

export type ProductSubmissionRejectionReason =
  'DECLARED_NUTRITION_BASIS_REQUIRED' | 'DIMENSION_BASIS_CONFLICT';

export class ProductSubmissionError extends Error {
  readonly reason: ProductSubmissionRejectionReason;

  constructor(message: string, reason: ProductSubmissionRejectionReason) {
    super(message);
    this.name = 'ProductSubmissionError';
    this.reason = reason;
  }
}

export interface CreatePackagedProductInput {
  barcode: string;
  name: string;
  nameAr?: string;
  brand?: string;
  category?: string;
  servingSize?: number;
  servingUnit?: string;
  packageSize?: number;
  packageUnit?: string;
  declaredNutritionBasis: NutritionBasis;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  fiberPer100g?: number;
  sugarPer100g?: number;
  // Grams per 100 base units — the form collects milligrams and converts.
  sodiumPer100g?: number;
  country?: string;
}

export async function createPackagedProduct(
  input: CreatePackagedProductInput,
): Promise<PackagedProduct> {
  try {
    const { data } = await apiClient.post('/food/products', input);
    return data;
  } catch (err) {
    if (isAxiosError(err) && err.response?.status === 409) {
      throw new ProductConflictError();
    }
    const reason = isAxiosError(err) ? err.response?.data?.reason : undefined;
    if (
      isAxiosError(err) &&
      err.response?.status === 400 &&
      (reason === 'DECLARED_NUTRITION_BASIS_REQUIRED' ||
        reason === 'DIMENSION_BASIS_CONFLICT')
    ) {
      const message = err.response?.data?.message;
      throw new ProductSubmissionError(
        typeof message === 'string'
          ? message
          : 'The product cannot be created with these portion details.',
        reason,
      );
    }
    throw err;
  }
}
