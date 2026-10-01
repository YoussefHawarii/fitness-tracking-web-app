import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ContainerKey, type BaseUnit } from '@prisma/client';
import type { NutrientsPer100g } from '../calorie-calculator';
import { mapOffPackagingShapes } from '../container-key';
import { normalizeMeasurement } from '../unit-normalizer';

export const OPEN_FOOD_FACTS_TIMEOUT_MS = 8_000;

interface OpenFoodFactsResponse {
  status: number; // 1 = product found, 0 = not found — NOT the HTTP status code
  product?: {
    product_name?: string;
    product_name_ar?: string;
    brands?: string;
    categories?: string;
    countries?: string;
    image_front_url?: string;
    image_url?: string;
    product_quantity?: number | string;
    product_quantity_unit?: string;
    serving_quantity?: number | string;
    serving_quantity_unit?: string;
    quantity?: string;
    serving_size?: string;
    packagings?: Array<{ shape?: string }>;
    nutriments?: {
      'energy-kcal_100g'?: number;
      proteins_100g?: number;
      carbohydrates_100g?: number;
      fat_100g?: number;
      fiber_100g?: number;
      sugars_100g?: number;
      sodium_100g?: number;
    };
  };
}

export interface OpenFoodFactsProduct extends NutrientsPer100g {
  name: string;
  barcode: string;
  // The fields below are additive — the pre-existing OPEN_FOOD_FACTS food-log
  // resolution path (food.service.ts resolveNutrients) only ever reads
  // name/barcode/the four NutrientsPer100g fields, so populating these never
  // changes that path's behavior. They exist for the local-first packaged
  // product cache (ProductResolverService), which needs the fuller record.
  nameAr?: string | null;
  brand?: string | null;
  category?: string | null;
  servingSize?: number | null;
  servingUnit?: string | null;
  servingBaseUnit?: BaseUnit | null;
  packageSize?: number | null;
  packageUnit?: string | null;
  packageBaseUnit?: BaseUnit | null;
  containerKey?: ContainerKey | null;
  fiberPer100g?: number | null;
  sugarPer100g?: number | null;
  sodiumPer100g?: number | null;
  imageUrl?: string | null;
  country?: string | null;
}

export interface OpenFoodFactsIdentification {
  barcode: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  servingSize?: number;
  servingUnit?: string;
  servingBaseUnit?: BaseUnit;
  packageSize?: number;
  packageUnit?: string;
  packageBaseUnit?: BaseUnit;
  containerKey?: ContainerKey;
}

export type OpenFoodFactsLookupResult =
  | ({ outcome: 'FOUND_WITH_NUTRITION' } & OpenFoodFactsProduct)
  | {
      outcome: 'FOUND_WITHOUT_NUTRITION';
      identification: OpenFoodFactsIdentification;
    }
  | { outcome: 'NOT_FOUND' };

// OFF's `categories`/`countries` are comma-separated tag lists (broadest or
// most-recently-added first, depending on the field) — take the first
// segment as a short, displayable value rather than dumping the whole list.
function firstSegment(text: string | undefined): string | null {
  if (!text) return null;
  const first = text.split(',')[0]?.trim();
  return first || null;
}

@Injectable()
export class OpenFoodFactsClient {
  private readonly baseUrl = 'https://world.openfoodfacts.org/api/v2/product';

  async lookupByBarcode(barcode: string): Promise<OpenFoodFactsLookupResult> {
    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(),
      OPEN_FOOD_FACTS_TIMEOUT_MS,
    );
    let response: Response;
    try {
      response = await fetch(
        `${this.baseUrl}/${encodeURIComponent(barcode)}.json`,
        {
          signal: abortController.signal,
          // OFF's own integration guidance asks for an identifying User-Agent —
          // per docs/food-log-input-modes-diagnosis.md §1.2, unidentified
          // shared-backend traffic risks being throttled more aggressively.
          headers: {
            'User-Agent':
              'FitnessTrackingWebApp/1.0 (+https://github.com/YoussefHawarii/fitness-tracking-web-app)',
          },
        },
      );
    } catch {
      clearTimeout(timeout);
      throw new ServiceUnavailableException(
        'Barcode lookup is temporarily unavailable.',
      );
    }
    // Open Food Facts is inconsistent about how it reports "no such product":
    // a malformed barcode gets HTTP 200 + body.status 0, but a well-formed
    // barcode that simply isn't in their database gets a genuine HTTP 404 —
    // confirmed by calling the live API, not just their docs. Both mean "not
    // found", not "the service is down"; only treat other non-OK statuses
    // (5xx, etc.) as an outage.
    if (response.status === 404) {
      clearTimeout(timeout);
      return { outcome: 'NOT_FOUND' };
    }
    if (!response.ok) {
      clearTimeout(timeout);
      throw new ServiceUnavailableException(
        'Barcode lookup is temporarily unavailable.',
      );
    }
    let body: OpenFoodFactsResponse;
    try {
      body = (await response.json()) as OpenFoodFactsResponse;
    } catch {
      throw new ServiceUnavailableException(
        'Barcode lookup is temporarily unavailable.',
      );
    } finally {
      clearTimeout(timeout);
    }

    // Open Food Facts returns HTTP 200 even with no data for the barcode —
    // the body's own `status` field is the real signal (docs/business-logic.md §5).
    if (body.status !== 1 || !body.product) {
      return { outcome: 'NOT_FOUND' };
    }

    const nutriments = body.product.nutriments ?? {};
    const caloriesPer100g = nutriments['energy-kcal_100g'];
    const name = body.product.product_name ?? 'Unknown product';
    const brand = body.product.brands?.trim() || null;
    const imageUrl =
      body.product.image_front_url ?? body.product.image_url ?? null;
    const serving = normalizeMeasurement(
      body.product.serving_quantity,
      body.product.serving_quantity_unit,
    );
    const packageMeasurement = normalizeMeasurement(
      body.product.product_quantity,
      body.product.product_quantity_unit,
    );
    const containerKey = mapOffPackagingShapes(body.product.packagings);
    if (
      typeof caloriesPer100g !== 'number' ||
      !Number.isFinite(caloriesPer100g) ||
      caloriesPer100g <= 0
    ) {
      return {
        outcome: 'FOUND_WITHOUT_NUTRITION',
        identification: {
          barcode,
          name,
          brand,
          imageUrl,
          ...(serving
            ? {
                servingSize: serving.value,
                servingUnit: serving.legacyUnit,
                servingBaseUnit: serving.baseUnit,
              }
            : {}),
          ...(packageMeasurement
            ? {
                packageSize: packageMeasurement.value,
                packageUnit: packageMeasurement.legacyUnit,
                packageBaseUnit: packageMeasurement.baseUnit,
              }
            : {}),
          ...(containerKey !== ContainerKey.PACKAGE ? { containerKey } : {}),
        },
      };
    }
    return {
      outcome: 'FOUND_WITH_NUTRITION',
      barcode,
      name,
      caloriesPer100g,
      proteinPer100g: nutriments.proteins_100g ?? null,
      carbsPer100g: nutriments.carbohydrates_100g ?? null,
      fatPer100g: nutriments.fat_100g ?? null,
      nameAr: body.product.product_name_ar ?? null,
      brand,
      category: firstSegment(body.product.categories),
      servingSize: serving?.value ?? null,
      servingUnit: serving?.legacyUnit ?? null,
      servingBaseUnit: serving?.baseUnit ?? null,
      packageSize: packageMeasurement?.value ?? null,
      packageUnit: packageMeasurement?.legacyUnit ?? null,
      packageBaseUnit: packageMeasurement?.baseUnit ?? null,
      containerKey,
      fiberPer100g: nutriments.fiber_100g ?? null,
      sugarPer100g: nutriments.sugars_100g ?? null,
      sodiumPer100g: nutriments.sodium_100g ?? null,
      imageUrl,
      country: firstSegment(body.product.countries),
    };
  }
}
