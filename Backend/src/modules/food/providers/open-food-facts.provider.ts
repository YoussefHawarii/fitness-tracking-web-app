import { Injectable } from '@nestjs/common';
import { ProductSource } from '@prisma/client';
import { OpenFoodFactsClient } from '../clients/open-food-facts.client';
import type {
  ProductLookupResult,
  ProductProvider,
} from './product-provider.interface';

// Thin adapter over the existing OpenFoodFactsClient — the HTTP call, OFF's
// inconsistent not-found signaling, and the missing-calorie-data handling
// all stay in the client (unchanged, still used directly by the legacy
// OPEN_FOOD_FACTS food-log resolution path too). This class only maps that
// client's result into the shape ProductResolverService expects.
@Injectable()
export class OpenFoodFactsProvider implements ProductProvider {
  readonly source = ProductSource.OPEN_FOOD_FACTS;

  constructor(private readonly client: OpenFoodFactsClient) {}

  async lookupByBarcode(
    canonicalBarcode: string,
  ): Promise<ProductLookupResult | null> {
    const product = await this.client.lookupByBarcode(canonicalBarcode);
    if (!product) return null;

    return {
      name: product.name,
      nameAr: product.nameAr ?? null,
      brand: product.brand ?? null,
      category: product.category ?? null,
      servingSize: product.servingSize ?? null,
      servingUnit: product.servingUnit ?? null,
      packageSize: product.packageSize ?? null,
      packageUnit: product.packageUnit ?? null,
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
    };
  }
}
