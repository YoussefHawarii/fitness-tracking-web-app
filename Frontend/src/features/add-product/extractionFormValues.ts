import type { NutritionBasis } from '../../services/foodService';
import type { LabelField, LabelScanResult } from '../label-scan/labelReader';

// Readings-to-form merge: turns a Label scan's result into Add Product
// field updates. A Label reading is only ever a suggestion — it reaches the
// form when the user presses Apply, and it never replaces a value already
// in a field or a Nutrition basis the user picked.

export type LabelFormValues = Record<LabelField, string>;

export interface LabelFormState {
  values: LabelFormValues;
  basis: NutritionBasis | '';
  basisSelectedByUser: boolean;
}

export interface LabelFormUpdate {
  values: Partial<LabelFormValues>;
  basis?: NutritionBasis;
  // Set when the form already has a different basis than the label states:
  // the label's per-100 values would be filed under the wrong denominator,
  // so none are applied and the user decides.
  basisConflict?: { label: NutritionBasis; form: NutritionBasis };
}

export function labelScanToFormUpdate(
  result: LabelScanResult,
  state: LabelFormState,
): LabelFormUpdate {
  // Only readings from a column the label headed per 100 g / 100 ml may
  // fill a per-100 field (ADR 0009); anything else is reference only.
  if (result.outcome !== 'ok') return { values: {} };
  if (
    state.basis !== '' &&
    result.basisSuggestion !== undefined &&
    state.basis !== result.basisSuggestion
  ) {
    return {
      values: {},
      basisConflict: { label: result.basisSuggestion, form: state.basis },
    };
  }

  const values: Partial<LabelFormValues> = {};
  for (const reading of result.readings) {
    if (reading.value === undefined || reading.status === 'not-found') continue;
    if (state.values[reading.field].trim() !== '') continue;
    values[reading.field] = String(reading.value);
  }

  const basis =
    !state.basisSelectedByUser &&
    state.basis === '' &&
    result.basisSuggestion !== undefined
      ? result.basisSuggestion
      : undefined;

  return { values, ...(basis && { basis }) };
}
