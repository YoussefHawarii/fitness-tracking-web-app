import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { NutrientsPer100g } from '../calorie-calculator';

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
    // Total quantity of the product as sold, e.g. "330ml" — maps to
    // packageSize/packageUnit, distinct from serving_size below.
    quantity?: string;
    serving_size?: string;
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
  packageSize?: number | null;
  packageUnit?: string | null;
  fiberPer100g?: number | null;
  sugarPer100g?: number | null;
  sodiumPer100g?: number | null;
  imageUrl?: string | null;
  country?: string | null;
}

// Best-effort parse of Open Food Facts' free-text size fields (e.g. "30 g",
// "1 bar (40g)", "330ml"). Only accepts a clean "<number><unit>" match at the
// start of the string — anything else is left null rather than guessed, per
// this app's "don't fabricate missing data" rule.
function parseSize(
  text: string | undefined,
): { size: number; unit: string } | null {
  if (!text) return null;
  const match = text.trim().match(/^([\d.]+)\s*([a-zA-Zµ]+)/);
  if (!match) return null;
  const size = Number(match[1]);
  if (!Number.isFinite(size) || size <= 0) return null;
  return { size, unit: match[2].toLowerCase() };
}

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

  async lookupByBarcode(barcode: string): Promise<OpenFoodFactsProduct | null> {
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
      return null;
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
    const servingSize = parseSize(body.product.serving_size);
    const packageSize = parseSize(body.product.quantity);
    return {
      barcode,
      name: body.product.product_name ?? 'Unknown product',
      caloriesPer100g,
      proteinPer100g: nutriments.proteins_100g ?? null,
      carbsPer100g: nutriments.carbohydrates_100g ?? null,
      fatPer100g: nutriments.fat_100g ?? null,
      nameAr: body.product.product_name_ar ?? null,
      brand: body.product.brands?.trim() || null,
      category: firstSegment(body.product.categories),
      servingSize: servingSize?.size ?? null,
      servingUnit: servingSize?.unit ?? null,
      packageSize: packageSize?.size ?? null,
      packageUnit: packageSize?.unit ?? null,
      fiberPer100g: nutriments.fiber_100g ?? null,
      sugarPer100g: nutriments.sugars_100g ?? null,
      sodiumPer100g: nutriments.sodium_100g ?? null,
      imageUrl: body.product.image_front_url ?? body.product.image_url ?? null,
      country: firstSegment(body.product.countries),
    };
  }
}
