import type { NutritionBasis } from '../../services/foodService';
import type {
  LabelField,
  LabelReading,
  LabelScanResult,
} from '../label-scan/labelReader';

// Readings-to-form merge: plans what Apply does to the Add Product form.
// A Label reading is only ever a suggestion — it reaches the form when the
// user selects it and presses Apply, and it never replaces a User-edited
// field (one the user typed into or changed, including while recognition
// was running) or a Nutrition basis the user picked.

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
  // The product name, only to report it as missing.
  name?: string;
  basis: NutritionBasis | '';
  basisSelectedByUser: boolean;
  // Fields whose current value came from an earlier scan and hasn't been
  // edited since. A later scan may update them; every other non-empty
  // field is the user's and is never overwritten.
  scanFilled?: ReadonlySet<LabelFormField>;
}

export interface LabelFieldConflict {
  field: LabelField;
  label: string;
  form: string;
}

export type RequiredFormField =
  | 'name'
  | 'basis'
  | 'caloriesPer100g'
  | 'proteinPer100g'
  | 'carbsPer100g'
  | 'fatPer100g';

export interface LabelFormUpdate {
  values: Partial<LabelFormValues>;
  basis?: NutritionBasis;
  // Set when the form already has a different basis than the label states:
  // the label's per-100 values would be filed under the wrong denominator,
  // so none are applied and the user decides.
  basisConflict?: { label: NutritionBasis; form: NutritionBasis };
  // Selected readings that differ from what the user entered; not applied.
  conflicts: LabelFieldConflict[];
  // Required fields that would still be empty after this Apply.
  missingRequired: RequiredFormField[];
}

const SIZE_UNIT_FIELDS: Partial<Record<LabelField, LabelFormField>> = {
  servingSize: 'servingUnit',
  packageSize: 'packageUnit',
};

const SIZE_FORM_FIELDS: ReadonlySet<LabelFormField> = new Set([
  'servingSize',
  'servingUnit',
  'packageSize',
  'packageUnit',
]);

const REQUIRED_VALUE_FIELDS = [
  'caloriesPer100g',
  'proteinPer100g',
  'carbsPer100g',
  'fatPer100g',
] as const;

const isEmpty = (value: string | undefined) => (value ?? '').trim() === '';

// Readings that can be applied at all: from a per-100 table, with a value.
export function applicableReadings(result: LabelScanResult): LabelReading[] {
  if (result.outcome !== 'ok') return [];
  return result.readings.filter(
    (r) => r.value !== undefined && r.status !== 'not-found',
  );
}

// What is selected before the user changes anything: every applicable
// reading — except after a weak scan, where nothing is pre-selected.
export function defaultLabelSelection(
  result: LabelScanResult,
): Set<LabelField> {
  if (result.weakScan) return new Set();
  return new Set(applicableReadings(result).map((r) => r.field));
}

export function planLabelApply(
  result: LabelScanResult,
  state: LabelFormState,
  selected: ReadonlySet<LabelField> = defaultLabelSelection(result),
): LabelFormUpdate {
  const scanFilled = state.scanFilled ?? new Set<LabelFormField>();
  // A field the scan may write: empty, or last written by a scan.
  const writable = (field: LabelFormField) =>
    isEmpty(state.values[field]) || scanFilled.has(field);

  const values: Partial<LabelFormValues> = {};
  const conflicts: LabelFieldConflict[] = [];
  let basis: NutritionBasis | undefined;
  let basisConflict: LabelFormUpdate['basisConflict'];

  if (
    result.outcome === 'ok' &&
    state.basis !== '' &&
    result.basisSuggestion !== undefined &&
    state.basis !== result.basisSuggestion
  ) {
    basisConflict = { label: result.basisSuggestion, form: state.basis };
  }

  // Only readings from a column the label headed per 100 g / 100 ml may
  // fill a per-100 field (ADR 0009); nothing is applied under a basis the
  // label contradicts.
  if (!basisConflict) {
    for (const reading of applicableReadings(result)) {
      if (!selected.has(reading.field)) continue;
      const label = String(reading.value);
      const unitField = SIZE_UNIT_FIELDS[reading.field];
      if (unitField) {
        // A size and its unit are written together, and only into a pair
        // the scan may write, so a scanned unit never lands beside a typed
        // number.
        const sizeField = reading.field as 'servingSize' | 'packageSize';
        const unit = reading.unit ?? '';
        if (writable(sizeField) && writable(unitField)) {
          values[sizeField] = label;
          values[unitField] = unit;
        } else if (
          state.values[sizeField].trim() !== label ||
          state.values[unitField].trim() !== unit
        ) {
          conflicts.push({
            field: reading.field,
            label: `${label} ${unit}`.trim(),
            form: `${state.values[sizeField]} ${state.values[unitField]}`.trim(),
          });
        }
        continue;
      }
      const field = reading.field as LabelFormField;
      if (writable(field)) {
        values[field] = label;
      } else if (Number(state.values[field]) !== reading.value) {
        conflicts.push({
          field: reading.field,
          label,
          form: state.values[field].trim(),
        });
      }
    }

    // The label's basis travels with its per-100 values: suggested only
    // when at least one of them is applied.
    const appliesPer100Value = Object.keys(values).some(
      (field) => !SIZE_FORM_FIELDS.has(field as LabelFormField),
    );
    if (
      appliesPer100Value &&
      !state.basisSelectedByUser &&
      state.basis === '' &&
      result.basisSuggestion !== undefined
    ) {
      basis = result.basisSuggestion;
    }
  }

  const after = { ...state.values, ...values };
  const missingRequired: RequiredFormField[] = [
    ...(isEmpty(state.name) ? (['name'] as const) : []),
    ...(state.basis === '' && !basis ? (['basis'] as const) : []),
    ...REQUIRED_VALUE_FIELDS.filter((field) => isEmpty(after[field])),
  ];

  return {
    values,
    ...(basis && { basis }),
    ...(basisConflict && { basisConflict }),
    conflicts,
    missingRequired,
  };
}

// The default Apply: every applicable reading selected (none after a weak
// scan).
export function labelScanToFormUpdate(
  result: LabelScanResult,
  state: LabelFormState,
): LabelFormUpdate {
  return planLabelApply(result, state);
}
