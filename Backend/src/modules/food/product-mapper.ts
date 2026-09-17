import type { PackagedProduct } from '@prisma/client';

// Prisma Decimal fields serialize to strings by default (matching this app's
// existing FoodLogEntry response shape) — but the pre-existing barcode
// response contract (OpenFoodFactsProduct, a plain object from the OFF
// client, not Prisma) has always returned real numbers. Converting here
// keeps that contract intact for the frontend.
export function serializePackagedProduct(product: PackagedProduct) {
  return {
    id: product.id,
    barcode: product.barcode,
    name: product.name,
    nameAr: product.nameAr,
    brand: product.brand,
    category: product.category,
    servingSize: product.servingSize ? Number(product.servingSize) : null,
    servingUnit: product.servingUnit,
    packageSize: product.packageSize ? Number(product.packageSize) : null,
    packageUnit: product.packageUnit,
    caloriesPer100g: Number(product.caloriesPer100g),
    proteinPer100g: product.proteinPer100g
      ? Number(product.proteinPer100g)
      : null,
    carbsPer100g: product.carbsPer100g ? Number(product.carbsPer100g) : null,
    fatPer100g: product.fatPer100g ? Number(product.fatPer100g) : null,
    fiberPer100g: product.fiberPer100g ? Number(product.fiberPer100g) : null,
    sugarPer100g: product.sugarPer100g ? Number(product.sugarPer100g) : null,
    sodiumPer100g: product.sodiumPer100g ? Number(product.sodiumPer100g) : null,
    imageUrl: product.imageUrl,
    country: product.country,
    source: product.source,
    verificationStatus: product.verificationStatus,
  };
}
