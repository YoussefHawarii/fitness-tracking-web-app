export interface NutrientsPer100g {
  caloriesPer100g: number;
  proteinPer100g?: number | null;
  carbsPer100g?: number | null;
  fatPer100g?: number | null;
}

export interface ComputedNutrients {
  calories: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}

export type CalculationAmountUnit = 'G' | 'ML';
export type CalculationNutritionBasis = 'PER_100_G' | 'PER_100_ML';

// (nutrient per 100g ÷ 100) × grams entered — docs/business-logic.md §4.
// Applies uniformly to calories and any tracked macro.
function scaleToGrams(
  per100g: number | null | undefined,
  grams: number,
): number | null {
  if (per100g === null || per100g === undefined) return null;
  return (per100g / 100) * grams;
}

export function calculateNutrientsForGrams(
  nutrients: NutrientsPer100g,
  grams: number,
): ComputedNutrients {
  return calculateNutrientsForAmount(nutrients, grams, 'G', 'PER_100_G');
}

export function calculateNutrientsForAmount(
  nutrients: NutrientsPer100g,
  amount: number,
  amountUnit: CalculationAmountUnit,
  nutritionBasis: CalculationNutritionBasis,
): ComputedNutrients {
  const expectedUnit = nutritionBasis === 'PER_100_G' ? 'G' : 'ML';
  if (amountUnit !== expectedUnit) {
    throw new Error('Consumed amount unit does not match nutrition basis.');
  }
  return {
    calories: scaleToGrams(nutrients.caloriesPer100g, amount) as number,
    protein: scaleToGrams(nutrients.proteinPer100g, amount),
    carbs: scaleToGrams(nutrients.carbsPer100g, amount),
    fat: scaleToGrams(nutrients.fatPer100g, amount),
  };
}
