import type {
  CreatePackagedProductInput,
  NutritionBasis,
} from '../../services/foodService';

export const DECLARED_BASIS_REQUIRED_MESSAGE =
  'Choose whether the nutrition values are per 100 g or 100 ml.';

// The Add Product form's raw text inputs, exactly as typed. Nutrient values
// are per 100 base units of the selected basis; sodium is in milligrams.
export interface AddProductFormFields {
  name: string;
  nameAr: string;
  brand: string;
  category: string;
  caloriesPer100g: string;
  proteinPer100g: string;
  carbsPer100g: string;
  fatPer100g: string;
  fiberPer100g: string;
  sugarPer100g: string;
  sodiumMgPer100: string;
  servingSize: string;
  servingUnit: string;
  packageSize: string;
  packageUnit: string;
  country: string;
}

function toNumber(v: string): number | undefined {
  if (v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// Labels print sodium in milligrams, so the form collects it in mg, but the
// stored Sodium value (and the create-product API) is grams per 100 base
// units — the convention Open Food Facts data already uses. Convert only at
// this submission boundary. Rounding to 12 significant digits strips float
// noise (123.4 / 1000) without zeroing any small positive value.
export function sodiumMgToGrams(mg: number): number {
  return Number((mg / 1000).toPrecision(12));
}

// Builds the create-product request from already-validated form fields: the
// required macros must parse as numbers before this is called. Blank
// optional fields are omitted rather than sent as empty or zero.
export function buildPackagedProductInput(
  barcode: string,
  fields: AddProductFormFields,
  basis: NutritionBasis,
): CreatePackagedProductInput {
  const fiber = toNumber(fields.fiberPer100g);
  const sugar = toNumber(fields.sugarPer100g);
  const sodiumMg = toNumber(fields.sodiumMgPer100);
  const serving = toNumber(fields.servingSize);
  const pkgSize = toNumber(fields.packageSize);
  const nameAr = fields.nameAr.trim();
  const brand = fields.brand.trim();
  const category = fields.category.trim();
  const servingUnit = fields.servingUnit.trim();
  const packageUnit = fields.packageUnit.trim();
  const country = fields.country.trim();

  return {
    barcode,
    name: fields.name.trim(),
    ...(nameAr && { nameAr }),
    ...(brand && { brand }),
    ...(category && { category }),
    caloriesPer100g: Number(fields.caloriesPer100g),
    proteinPer100g: Number(fields.proteinPer100g),
    carbsPer100g: Number(fields.carbsPer100g),
    fatPer100g: Number(fields.fatPer100g),
    ...(fiber !== undefined && { fiberPer100g: fiber }),
    ...(sugar !== undefined && { sugarPer100g: sugar }),
    ...(sodiumMg !== undefined && { sodiumPer100g: sodiumMgToGrams(sodiumMg) }),
    ...(serving !== undefined && { servingSize: serving }),
    ...(servingUnit && { servingUnit }),
    ...(pkgSize !== undefined && { packageSize: pkgSize }),
    ...(packageUnit && { packageUnit }),
    declaredNutritionBasis: basis,
    ...(country && { country }),
  };
}

export function withDeclaredNutritionBasis<T>(
  basis: NutritionBasis | '',
  submit: (basis: NutritionBasis) => T,
): { allowed: false; error: string } | { allowed: true; value: T } {
  if (!basis) {
    return { allowed: false, error: DECLARED_BASIS_REQUIRED_MESSAGE };
  }
  return { allowed: true, value: submit(basis) };
}
