import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NutrientsPer100g } from '../calorie-calculator';

interface UsdaSearchResponse {
  foods: Array<{
    fdcId: number;
    description: string;
    foodNutrients: Array<{ nutrientName: string; value: number }>;
  }>;
}

interface UsdaFoodDetailsResponse {
  fdcId: number;
  description: string;
  foodNutrients: Array<{ nutrient: { name: string }; amount: number }>;
}

export interface UsdaFoodMatch extends NutrientsPer100g {
  fdcId: string;
  name: string;
}

function extractNutrient(
  nutrients: Array<{ nutrientName: string; value: number }>,
  name: string,
): number | null {
  return nutrients.find((n) => n.nutrientName === name)?.value ?? null;
}

@Injectable()
export class UsdaClient {
  private readonly baseUrl = 'https://api.nal.usda.gov/fdc/v1';

  constructor(private readonly configService: ConfigService) {}

  // Returns candidate matches for the caller to present to the user —
  // never auto-selects a single result (docs/business-logic.md §5).
  async searchByTerm(term: string): Promise<UsdaFoodMatch[]> {
    const apiKey = this.configService.get<string>('USDA_API_KEY');
    const url = `${this.baseUrl}/foods/search?query=${encodeURIComponent(term)}&pageSize=5&api_key=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new ServiceUnavailableException(
        'USDA food search is temporarily unavailable.',
      );
    }
    const body = (await response.json()) as UsdaSearchResponse;

    const matches: UsdaFoodMatch[] = [];
    for (const food of body.foods ?? []) {
      const caloriesPer100g = extractNutrient(food.foodNutrients, 'Energy');
      // A record with no "Energy" entry at all (uncommon but real — see
      // docs/food-log-input-modes-diagnosis.md §3.3) can't be shown as a
      // candidate: silently defaulting to 0 kcal is worse than not offering
      // it, since the user has no way to tell it apart from a real 0.
      if (caloriesPer100g === null) continue;
      matches.push({
        fdcId: String(food.fdcId),
        name: food.description,
        caloriesPer100g,
        proteinPer100g: extractNutrient(food.foodNutrients, 'Protein'),
        carbsPer100g: extractNutrient(
          food.foodNutrients,
          'Carbohydrate, by difference',
        ),
        fatPer100g: extractNutrient(food.foodNutrients, 'Total lipid (fat)'),
      });
    }
    return matches;
  }

  // Fetches one food by its own fdcId — used when re-resolving an already
  // logged USDA food (e.g. on edit/resave), where searchByTerm would only
  // find it again by luck (it's a free-text search, not a lookup by id).
  async getById(fdcId: string): Promise<UsdaFoodMatch | null> {
    const apiKey = this.configService.get<string>('USDA_API_KEY');
    const url = `${this.baseUrl}/food/${encodeURIComponent(fdcId)}?api_key=${apiKey}`;
    const response = await fetch(url);
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new ServiceUnavailableException(
        'USDA food lookup is temporarily unavailable.',
      );
    }
    const body = (await response.json()) as UsdaFoodDetailsResponse;
    const nutrients = body.foodNutrients.map((n) => ({
      nutrientName: n.nutrient.name,
      value: n.amount,
    }));

    const caloriesPer100g = extractNutrient(nutrients, 'Energy');
    // Same missing-data case as searchByTerm — treat as not found rather
    // than silently resolving to 0 kcal on save/edit.
    if (caloriesPer100g === null) return null;

    return {
      fdcId: String(body.fdcId),
      name: body.description,
      caloriesPer100g,
      proteinPer100g: extractNutrient(nutrients, 'Protein'),
      carbsPer100g: extractNutrient(nutrients, 'Carbohydrate, by difference'),
      fatPer100g: extractNutrient(nutrients, 'Total lipid (fat)'),
    };
  }
}
