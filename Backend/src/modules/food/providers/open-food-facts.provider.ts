import { Injectable } from '@nestjs/common';
import { ProductSource } from '@prisma/client';
import { OpenFoodFactsClient } from '../clients/open-food-facts.client';
import type {
  ProductLookupResult,
  ProductProvider,
} from './product-provider.interface';
import { normalizeMeasurement } from '../unit-normalizer';

// Thin adapter over the existing OpenFoodFactsClient — the HTTP call, OFF's
// inconsistent not-found signaling, and the usable-calorie boundary all stay
// in the client, which is also used by the legacy OPEN_FOOD_FACTS food-log
// resolution path. This class only maps the client's result into the shape
// ProductResolverService expects.
@Injectable()
export class OpenFoodFactsProvider implements ProductProvider {
  readonly source = ProductSource.OPEN_FOOD_FACTS;

  constructor(private readonly client: OpenFoodFactsClient) {}

  async lookupByBarcode(
    canonicalBarcode: string,
  ): Promise<ProductLookupResult> {
    const result = await this.client.lookupByBarcode(canonicalBarcode);
    if (result.outcome === 'NOT_FOUND') return result;
    if (result.outcome === 'FOUND_WITHOUT_NUTRITION') {
      return {
        outcome: result.outcome,
        identification: {
          name: result.identification.name,
          brand: result.identification.brand,
          imageUrl: result.identification.imageUrl,
        },
      };
    }
    const product = result;
    const serving = normalizeMeasurement(
      product.servingSize,
      product.servingUnit,
    );
    const packageMeasurement = normalizeMeasurement(
      product.packageSize,
      product.packageUnit,
    );

    return {
      outcome: 'FOUND_WITH_NUTRITION',
      product: {
        name: product.name,
        nameAr: product.nameAr ?? null,
        brand: product.brand ?? null,
        category: product.category ?? null,
        servingSize: serving?.value ?? null,
        servingUnit: serving?.legacyUnit ?? null,
        servingBaseUnit: serving?.baseUnit ?? null,
        packageSize: packageMeasurement?.value ?? null,
        packageUnit: packageMeasurement?.legacyUnit ?? null,
        packageBaseUnit: packageMeasurement?.baseUnit ?? null,
        containerKey: product.containerKey ?? null,
        caloriesPer100g: product.caloriesPer100g,
        proteinPer100g: product.proteinPer100g ?? null,
        carbsPer100g: product.carbsPer100g ?? null,
        fatPer100g: product.fatPer100g ?? null,
        fiberPer100g: product.fiberPer100g ?? null,
        sugarPer100g: product.sugarPer100g ?? null,
        sodiumPer100g: product.sodiumPer100g ?? null,
        imageUrl: product.imageUrl ?? null,
        country: product.country ?? null,
        sourceId: product.barcode,
      },
    };
  }
}
