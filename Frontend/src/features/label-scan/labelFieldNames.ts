import type { LabelField } from './labelReader';

// How each Label reading's field is named to the user.
export const LABEL_FIELD_NAMES: Record<LabelField, string> = {
  caloriesPer100g: 'Calories',
  proteinPer100g: 'Protein',
  carbsPer100g: 'Carbs',
  sugarPer100g: 'Sugars',
  fatPer100g: 'Fat',
  fiberPer100g: 'Fiber',
  sodiumMgPer100: 'Sodium',
  servingSize: 'Serving size',
  packageSize: 'Package size',
};
