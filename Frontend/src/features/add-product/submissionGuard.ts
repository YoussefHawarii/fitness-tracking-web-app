import type { NutritionBasis } from '../../services/foodService';

export const DECLARED_BASIS_REQUIRED_MESSAGE =
  'Choose whether the nutrition values are per 100 g or 100 ml.';

export function withDeclaredNutritionBasis<T>(
  basis: NutritionBasis | '',
  submit: (basis: NutritionBasis) => T,
): { allowed: false; error: string } | { allowed: true; value: T } {
  if (!basis) {
    return { allowed: false, error: DECLARED_BASIS_REQUIRED_MESSAGE };
  }
  return { allowed: true, value: submit(basis) };
}
