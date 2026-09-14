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
      {
        // OFF's own integration guidance asks for an identifying User-Agent —
        // per docs/food-log-input-modes-diagnosis.md §1.2, unidentified
        // shared-backend traffic risks being throttled more aggressively.
        headers: {
          'User-Agent':
            'FitnessTrackingWebApp/1.0 (+https://github.com/YoussefHawarii/fitness-tracking-web-app)',
        },
      },
    );
    // Open Food Facts is inconsistent about how it reports "no such product":
    // a malformed barcode gets HTTP 200 + body.status 0, but a well-formed
    // barcode that simply isn't in their database gets a genuine HTTP 404 —
    // confirmed by calling the live API, not just their docs. Both mean "not
    // found", not "the service is down"; only treat other non-OK statuses
    // (5xx, etc.) as an outage.
    if (response.status === 404) {
      return null;
    }
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
    const caloriesPer100g = nutriments['energy-kcal_100g'];
    // Open Food Facts is crowd-sourced — a product can exist with no
    // nutrition facts submitted at all. Silently showing 0 kcal would be
    // worse than not offering it; treat it the same as "not found" so the
    // caller falls back to the existing not-found/manual-search flow.
    if (caloriesPer100g === undefined) {
      return null;
    }
    return {
      barcode,
      name: body.product.product_name ?? 'Unknown product',
      caloriesPer100g,
      proteinPer100g: nutriments.proteins_100g ?? null,
      carbsPer100g: nutriments.carbohydrates_100g ?? null,
      fatPer100g: nutriments.fat_100g ?? null,
    };
  }
}
