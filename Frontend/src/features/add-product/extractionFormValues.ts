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
  // edited since. A later scan may update them.
  scanFilled?: ReadonlySet<LabelFormField>;
  // User-edited fields: typed into, changed or cleared by the user. A scan
  // never writes them, even when the user left one empty.
  userEdited?: ReadonlySet<LabelFormField>;
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
  // Selected readings that differ from what the user entered (or cleared);
  // not applied.
  conflicts: LabelFieldConflict[];
  // Required fields that would still be empty after this Apply.
  missingRequired: RequiredFormField[];
}

const SIZE_UNIT_FIELDS: Partial<Record<LabelField, LabelFormField>> = {
  servingSize: 'servingUnit',
  packageSize: 'packageUnit',
};

const PER_100_FORM_FIELDS = [
  'caloriesPer100g',
  'proteinPer100g',
  'carbsPer100g',
  'sugarPer100g',
  'fatPer100g',
  'fiberPer100g',
  'sodiumMgPer100',
] as const satisfies readonly LabelFormField[];

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

export function toggleLabelSelection(
  selected: ReadonlySet<LabelField>,
  field: LabelField,
): Set<LabelField> {
  const next = new Set(selected);
  if (next.has(field)) next.delete(field);
  else next.add(field);
  return next;
}

// Apply is offered only when at least one reading is selected.
export function canApplyLabelSelection(
  selected: ReadonlySet<LabelField>,
): boolean {
  return selected.size > 0;
}

function sameSize(
  formSize: string,
  formUnit: string,
  value: number,
  unit: string,
): boolean {
  return (
    !isEmpty(formSize) &&
    Number(formSize) === value &&
    formUnit.trim().toLowerCase() === unit.toLowerCase()
  );
}

export function planLabelApply(
  result: LabelScanResult,
  state: LabelFormState,
  selected: ReadonlySet<LabelField> = defaultLabelSelection(result),
): LabelFormUpdate {
  const scanFilled = state.scanFilled ?? new Set<LabelFormField>();
  const userEdited = state.userEdited ?? new Set<LabelFormField>();
  // A field the scan may write: never a User-edited field (even one the
  // user cleared), otherwise an empty one or one last written by a scan.
  const writable = (field: LabelFormField) =>
    !userEdited.has(field) &&
    (isEmpty(state.values[field]) || scanFilled.has(field));

  // Per-100 values the user entered: a basis change would reinterpret them.
  const userPer100 = PER_100_FORM_FIELDS.filter(
    (field) =>
      userEdited.has(field) ||
      (!isEmpty(state.values[field]) && !scanFilled.has(field)),
  );
  const labelBasis =
    result.outcome === 'ok' ? result.basisSuggestion : undefined;
  const basisDiffers =
    labelBasis !== undefined &&
    state.basis !== '' &&
    state.basis !== labelBasis;
  // A basis set by an earlier scan, with no per-100 value of the user's,
  // may follow a re-scan; otherwise a different basis is the user's call.
  const canSwitchBasis =
    basisDiffers && !state.basisSelectedByUser && userPer100.length === 0;
  const basisConflict =
    basisDiffers && !canSwitchBasis && state.basis !== ''
      ? { label: labelBasis, form: state.basis }
      : undefined;

  const values: Partial<LabelFormValues> = {};
  const conflicts: LabelFieldConflict[] = [];

  for (const reading of applicableReadings(result)) {
    if (!selected.has(reading.field)) continue;
    const label = String(reading.value);
    const unitField = SIZE_UNIT_FIELDS[reading.field];
    if (unitField) {
      // A size and its unit are written together, and only into a pair the
      // scan may write, so a scanned unit never lands beside a typed
      // number. Sizes don't depend on the basis.
      const sizeField = reading.field as 'servingSize' | 'packageSize';
      const unit = reading.unit ?? '';
      if (writable(sizeField) && writable(unitField)) {
        values[sizeField] = label;
        values[unitField] = unit;
      } else if (
        !sameSize(
          state.values[sizeField],
          state.values[unitField],
          reading.value as number,
          unit,
        )
      ) {
        conflicts.push({
          field: reading.field,
          label: `${label} ${unit}`.trim(),
          form: `${state.values[sizeField]} ${state.values[unitField]}`.trim(),
        });
      }
      continue;
    }
    // Only readings from a column the label headed per 100 g / 100 ml may
    // fill a per-100 field (ADR 0009); none under a basis the label
    // contradicts.
    if (basisConflict) continue;
    const field = reading.field as LabelFormField;
    if (writable(field)) {
      values[field] = label;
    } else if (
      isEmpty(state.values[field]) ||
      Number(state.values[field]) !== reading.value
    ) {
      conflicts.push({
        field: reading.field,
        label,
        form: state.values[field].trim(),
      });
    }
  }

  // The label's basis travels with its per-100 values: set only when at
  // least one of them is applied.
  const appliesPer100Value = PER_100_FORM_FIELDS.some(
    (field) => values[field] !== undefined,
  );
  let basis: NutritionBasis | undefined;
  if (appliesPer100Value && labelBasis !== undefined) {
    if (state.basis === '' && !state.basisSelectedByUser) basis = labelBasis;
    if (canSwitchBasis) {
      basis = labelBasis;
      // Earlier scanned per-100 values not re-read now would silently take
      // the new basis: they are cleared instead.
      for (const field of PER_100_FORM_FIELDS) {
        if (scanFilled.has(field) && values[field] === undefined) {
          values[field] = '';
        }
      }
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

const BASIS_NAMES: Record<NutritionBasis, string> = {
  PER_100_G: '100 g',
  PER_100_ML: '100 ml',
};

export interface LabelFormWriter {
  write: (field: LabelFormField, value: string) => void;
  // Whether the field now holds a scanned value (false when the plan
  // cleared a stale scanned value).
  markScanFilled: (field: LabelFormField, filled: boolean) => void;
  setBasis: (basis: NutritionBasis) => void;
}

// Carries out a planned Apply on the form and describes what happened.
// Everything planned is written — under a basis conflict that is only the
// serving and package sizes, which don't depend on the basis.
export function applyLabelUpdate(
  update: LabelFormUpdate,
  form: LabelFormWriter,
): string {
  const applied = Object.entries(update.values) as [LabelFormField, string][];
  for (const [field, value] of applied) {
    form.write(field, value);
    form.markScanFilled(field, value !== '');
  }
  if (update.basis) form.setBasis(update.basis);

  if (update.basisConflict) {
    const { label, form: formBasis } = update.basisConflict;
    return `The label lists values per ${BASIS_NAMES[label]}, but the form is set to per ${BASIS_NAMES[formBasis]} — its per-100 values weren’t applied. ${
      applied.length > 0
        ? 'The serving or package size was applied — check it.'
        : 'Change the basis or enter the values yourself.'
    }`;
  }
  return applied.length === 0
    ? 'Nothing was applied — the form already has your values.'
    : 'Applied to the form — check the values marked “from label” before creating the product.';
}

// The default Apply: every applicable reading selected (none after a weak
// scan).
export function labelScanToFormUpdate(
  result: LabelScanResult,
  state: LabelFormState,
): LabelFormUpdate {
  return planLabelApply(result, state);
}
