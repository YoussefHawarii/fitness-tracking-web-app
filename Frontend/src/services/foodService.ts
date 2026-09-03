import { apiClient } from './apiClient';

export type FoodSourceType = 'OPEN_FOOD_FACTS' | 'USDA' | 'LOCAL';
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

export interface UsdaFoodMatch extends NutrientsPer100g {
  fdcId: string;
  name: string;
}

export interface LocalFoodItem extends NutrientsPer100g {
  id: string;
  name: string;
}

export async function lookupBarcode(
  barcode: string,
): Promise<OpenFoodFactsProduct | null> {
  try {
    const { data } = await apiClient.get(
      `/food/barcode/${encodeURIComponent(barcode)}`,
    );
    return data;
  } catch {
    return null; // not found → caller falls through to manual entry
  }
}

export async function searchUsda(term: string): Promise<UsdaFoodMatch[]> {
  const { data } = await apiClient.get('/food/search-usda', {
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
