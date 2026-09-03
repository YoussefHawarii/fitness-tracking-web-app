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
  return {
    calories: scaleToGrams(nutrients.caloriesPer100g, grams) as number,
    protein: scaleToGrams(nutrients.proteinPer100g, grams),
    carbs: scaleToGrams(nutrients.carbsPer100g, grams),
    fat: scaleToGrams(nutrients.fatPer100g, grams),
  };
}
