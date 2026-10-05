import type { NutritionBasis } from '../../services/foodService';
import type { LabelField, LabelScanResult } from '../label-scan/labelReader';

// Readings-to-form merge: turns a Label scan's result into Add Product
// field updates. A Label reading is only ever a suggestion — it reaches the
// form when the user presses Apply, and it never replaces a value already
// in a field or a Nutrition basis the user picked.

// The Add Product fields a scan can fill. Sizes fill a number and a unit.
export type LabelFormField =
  | Exclude<LabelField, 'servingSize' | 'packageSize'>
  | 'servingSize'
  | 'servingUnit'
  | 'packageSize'
  | 'packageUnit';

export type LabelFormValues = Record<LabelFormField, string>;

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

const SIZE_UNIT_FIELDS: Partial<Record<LabelField, LabelFormField>> = {
  servingSize: 'servingUnit',
  packageSize: 'packageUnit',
};

const isEmpty = (value: string) => value.trim() === '';

export function labelScanToFormUpdate(
  result: LabelScanResult,
  state: LabelFormState,
): LabelFormUpdate {
  // Only readings from a column the label headed per 100 g / 100 ml may
  // fill a per-100 field (ADR 0009); anything else is reference only.
  if (result.outcome !== 'ok') return { values: {} };
  // A weak scan pre-selects nothing: the user decides what to keep.
  if (result.weakScan) return { values: {} };
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
    const unitField = SIZE_UNIT_FIELDS[reading.field];
    if (unitField) {
      // A size and its unit are filled together, and only into an empty
      // pair, so a scanned unit never lands beside a typed number.
      const sizeField = reading.field as 'servingSize' | 'packageSize';
      if (!isEmpty(state.values[sizeField])) continue;
      if (!isEmpty(state.values[unitField])) continue;
      values[sizeField] = String(reading.value);
      values[unitField] = reading.unit ?? '';
      continue;
    }
    const field = reading.field as LabelFormField;
    if (!isEmpty(state.values[field])) continue;
    values[field] = String(reading.value);
  }

  const basis =
    !state.basisSelectedByUser &&
    state.basis === '' &&
    result.basisSuggestion !== undefined
      ? result.basisSuggestion
      : undefined;

  return { values, ...(basis && { basis }) };
}
