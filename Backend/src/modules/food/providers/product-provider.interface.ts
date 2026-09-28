import type { BaseUnit, ContainerKey, ProductSource } from '@prisma/client';

// What a barcode provider hands back to ProductResolverService — already
// mapped into this app's own field names, so the resolver never needs to
// know which provider a result came from beyond the `source` tag it attaches
// itself (see OpenFoodFactsProvider.source).
export interface ProductLookupResult {
  name: string;
  nameAr?: string | null;
  brand?: string | null;
  category?: string | null;
  // Size values are expressed in the Base units named by the corresponding
  // *BaseUnit fields. The compatibility free-text unit fields are not trusted
  // by the persistence upsert; it derives lowercase units from the enums.
  servingSize?: number | null;
  servingUnit?: string | null;
  servingBaseUnit?: BaseUnit | null;
  packageSize?: number | null;
  packageUnit?: string | null;
  packageBaseUnit?: BaseUnit | null;
  containerKey?: ContainerKey | null;
  caloriesPer100g: number;
  proteinPer100g?: number | null;
  carbsPer100g?: number | null;
  fatPer100g?: number | null;
  fiberPer100g?: number | null;
  sugarPer100g?: number | null;
  sodiumPer100g?: number | null;
  imageUrl?: string | null;
  country?: string | null;
  // The provider's own id for this product, for future refresh/verification
  // — e.g. Open Food Facts' own code. May differ from our canonical barcode
  // for a future provider whose ids aren't barcodes themselves.
  sourceId?: string | null;
}

// A barcode-lookup data source, deliberately narrow (this is the only
// operation ProductResolverService needs). Implement this for any future
// Egyptian product source with legitimate API access — GS1 Egypt, a licensed
// FMCG database, etc. — without touching the resolver or the controller.
export interface ProductProvider {
  readonly source: ProductSource;
  lookupByBarcode(
    canonicalBarcode: string,
  ): Promise<ProductLookupResult | null>;
}
