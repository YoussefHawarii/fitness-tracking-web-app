import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { NutrientsPer100g } from '../calorie-calculator';

interface OpenFoodFactsResponse {
  status: number; // 1 = product found, 0 = not found — NOT the HTTP status code
  product?: {
    product_name?: string;
    nutriments?: {
      'energy-kcal_100g'?: number;
      proteins_100g?: number;
      carbohydrates_100g?: number;
      fat_100g?: number;
    };
  };
}

export interface OpenFoodFactsProduct extends NutrientsPer100g {
  name: string;
  barcode: string;
}

@Injectable()
export class OpenFoodFactsClient {
  private readonly baseUrl = 'https://world.openfoodfacts.org/api/v2/product';

  async lookupByBarcode(barcode: string): Promise<OpenFoodFactsProduct | null> {
    const response = await fetch(
      `${this.baseUrl}/${encodeURIComponent(barcode)}.json`,
    );
    if (!response.ok) {
      throw new ServiceUnavailableException(
        'Barcode lookup is temporarily unavailable.',
      );
    }
    const body = (await response.json()) as OpenFoodFactsResponse;

    // Open Food Facts returns HTTP 200 even with no data for the barcode —
    // the body's own `status` field is the real signal (docs/business-logic.md §5).
    if (body.status !== 1 || !body.product) {
      return null;
    }

    const nutriments = body.product.nutriments ?? {};
    return {
      barcode,
      name: body.product.product_name ?? 'Unknown product',
      caloriesPer100g: nutriments['energy-kcal_100g'] ?? 0,
      proteinPer100g: nutriments.proteins_100g ?? null,
      carbsPer100g: nutriments.carbohydrates_100g ?? null,
      fatPer100g: nutriments.fat_100g ?? null,
    };
  }
}
