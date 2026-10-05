import { useRef, useState } from 'react';
import {
  createPackagedProduct,
  ProductConflictError,
  ProductSubmissionError,
  type NutritionBasis,
  type PackagedProduct,
} from '../../services/foodService';
import { FieldLabel, Input, Select } from '../../components/ui/Input';
import { PrimaryButton, SecondaryButton } from '../../components/ui/Button';
import {
  planLabelApply,
  type LabelFormField,
  type LabelFormState,
} from './extractionFormValues';
import { LabelScanPanel } from '../label-scan/LabelScanPanel';
import type { LabelField, LabelScanResult } from '../label-scan/labelReader';
import {
  buildPackagedProductInput,
  withDeclaredNutritionBasis,
} from './submissionGuard';

interface Props {
  barcode: string;
  initialName?: string;
  initialBrand?: string;
  onCreated: (product: PackagedProduct) => void;
  onCancel?: () => void;
}

const BASIS_NAMES: Record<NutritionBasis, string> = {
  PER_100_G: '100 g',
  PER_100_ML: '100 ml',
};

// Shown under a field whose value came from a Label scan, until the user
// edits it.
function ScanHint({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="text-label normal-case tracking-normal text-accent">
      from label — check
    </span>
  );
}

export function validateNonNegative(v: string, label: string): string | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return `${label} must be 0 or more.`;
  return null;
}

export function AddProductForm({
  barcode,
  initialName,
  initialBrand,
  onCreated,
  onCancel,
}: Props) {
  const [name, setName] = useState(initialName ?? '');
  const [nameAr, setNameAr] = useState('');
  const [brand, setBrand] = useState(initialBrand ?? '');
  const [category, setCategory] = useState('');
  const [caloriesPer100g, setCaloriesPer100g] = useState('');
  const [proteinPer100g, setProteinPer100g] = useState('');
  const [carbsPer100g, setCarbsPer100g] = useState('');
  const [fatPer100g, setFatPer100g] = useState('');
  const [fiberPer100g, setFiberPer100g] = useState('');
  const [sugarPer100g, setSugarPer100g] = useState('');
  const [sodiumMgPer100, setSodiumMgPer100] = useState('');
  const [servingSize, setServingSize] = useState('');
  const [servingUnit, setServingUnit] = useState('');
  const [packageSize, setPackageSize] = useState('');
  const [packageUnit, setPackageUnit] = useState('');
  const [declaredNutritionBasis, setDeclaredNutritionBasis] = useState<
    NutritionBasis | ''
  >('');
  const basisSelectedByUser = useRef(false);
  const [country, setCountry] = useState('');
  // Fields whose value came from a Label scan and hasn't been edited since.
  // Any other non-empty field is a User-edited field a scan never touches.
  const [scanFilled, setScanFilled] = useState<ReadonlySet<LabelFormField>>(
    new Set(),
  );
  // User-edited fields: typed into, changed or cleared by the user.
  const [userEdited, setUserEdited] = useState<ReadonlySet<LabelFormField>>(
    new Set(),
  );

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const nutritionBasisLabel =
    declaredNutritionBasis === 'PER_100_G'
      ? '100 g'
      : declaredNutritionBasis === 'PER_100_ML'
        ? '100 ml'
        : 'selected basis';

  function toNumber(v: string): number | undefined {
    if (v.trim() === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }

  // A user edit makes the field the user's: a later scan won't touch it.
  function userEdit(
    field: LabelFormField,
    set: (value: string) => void,
    value: string,
  ) {
    set(value);
    setUserEdited((previous) =>
      previous.has(field) ? previous : new Set([...previous, field]),
    );
    setScanFilled((previous) => {
      if (!previous.has(field)) return previous;
      const next = new Set(previous);
      next.delete(field);
      return next;
    });
  }

  function labelFormState(): LabelFormState {
    return {
      values: {
        caloriesPer100g,
        proteinPer100g,
        carbsPer100g,
        sugarPer100g,
        fatPer100g,
        fiberPer100g,
        sodiumMgPer100,
        servingSize,
        servingUnit,
        packageSize,
        packageUnit,
      },
      name,
      basis: declaredNutritionBasis,
      basisSelectedByUser: basisSelectedByUser.current,
      scanFilled,
      userEdited,
    };
  }

  function previewLabelScan(
    result: LabelScanResult,
    selected: ReadonlySet<LabelField>,
  ) {
    return planLabelApply(result, labelFormState(), selected);
  }

  function handleApplyLabelScan(
    result: LabelScanResult,
    selected: ReadonlySet<LabelField>,
  ): string {
    const update = planLabelApply(result, labelFormState(), selected);
    if (update.basisConflict) {
      return `The label lists values per ${BASIS_NAMES[update.basisConflict.label]}, but the form is set to per ${BASIS_NAMES[update.basisConflict.form]} — nothing was applied. Change the basis or enter the values yourself.`;
    }
    const setters: Record<LabelFormField, (value: string) => void> = {
      caloriesPer100g: setCaloriesPer100g,
      proteinPer100g: setProteinPer100g,
      carbsPer100g: setCarbsPer100g,
      sugarPer100g: setSugarPer100g,
      fatPer100g: setFatPer100g,
      fiberPer100g: setFiberPer100g,
      sodiumMgPer100: setSodiumMgPer100,
      servingSize: setServingSize,
      servingUnit: setServingUnit,
      packageSize: setPackageSize,
      packageUnit: setPackageUnit,
    };
    const applied = Object.entries(update.values) as [LabelFormField, string][];
    for (const [field, value] of applied) setters[field](value);
    // A field cleared by the plan (a stale value after a basis change) is
    // no longer scan-filled.
    setScanFilled((previous) => {
      const next = new Set(previous);
      for (const [field, value] of applied) {
        if (value === '') next.delete(field);
        else next.add(field);
      }
      return next;
    });
    if (update.basis) setDeclaredNutritionBasis(update.basis);
    return applied.length === 0
      ? 'Nothing was applied — the form already has your values.'
      : 'Applied to the form — check the values marked “from label” before creating the product.';
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Name is required.');
      return;
    }

    const cal = toNumber(caloriesPer100g);
    const prot = toNumber(proteinPer100g);
    const carb = toNumber(carbsPer100g);
    const fat = toNumber(fatPer100g);

    if (
      cal === undefined ||
      prot === undefined ||
      carb === undefined ||
      fat === undefined
    ) {
      setError(
        'Calories, protein, carbs, and fat per 100g are required numbers.',
      );
      return;
    }

    for (const [val, label] of [
      [caloriesPer100g, 'Calories'],
      [proteinPer100g, 'Protein'],
      [carbsPer100g, 'Carbs'],
      [fatPer100g, 'Fat'],
      [fiberPer100g, 'Fiber'],
      [sugarPer100g, 'Sugar'],
      [sodiumMgPer100, 'Sodium'],
    ] as const) {
      const msg = validateNonNegative(val, label);
      if (msg) {
        setError(msg);
        return;
      }
    }

    const submission = withDeclaredNutritionBasis(
      declaredNutritionBasis,
      (selectedNutritionBasis) =>
        createPackagedProduct(
          buildPackagedProductInput(
            barcode,
            {
              name,
              nameAr,
              brand,
              category,
              caloriesPer100g,
              proteinPer100g,
              carbsPer100g,
              fatPer100g,
              fiberPer100g,
              sugarPer100g,
              sodiumMgPer100,
              servingSize,
              servingUnit,
              packageSize,
              packageUnit,
              country,
            },
            selectedNutritionBasis,
          ),
        ),
    );
    if (!submission.allowed) {
      setError(submission.error);
      return;
    }

    setSubmitting(true);
    try {
      const product = await submission.value;
      onCreated(product);
    } catch (err) {
      if (err instanceof ProductConflictError) {
        setError(
          'A product with this barcode already exists — try scanning again.',
        );
      } else if (err instanceof ProductSubmissionError) {
        setError(err.message);
      } else {
        setError('Could not create this product.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <p className="text-label text-text-muted normal-case tracking-normal">
        Barcode: {barcode}
      </p>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
        <p className="text-label text-text-muted normal-case tracking-normal">
          Scan nutrition label (optional)
        </p>
        <LabelScanPanel
          preview={previewLabelScan}
          onApply={handleApplyLabelScan}
        />
      </div>

      <FieldLabel>
        Product name (required)
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          dir="auto"
          required
        />
      </FieldLabel>

      <FieldLabel>
        Arabic name
        <Input
          value={nameAr}
          onChange={(e) => setNameAr(e.target.value)}
          dir="auto"
          placeholder="Optional"
        />
      </FieldLabel>

      <FieldLabel>
        Brand
        <Input
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          dir="auto"
          placeholder="e.g. Chipsy, Pepsi"
        />
      </FieldLabel>

      <FieldLabel>
        Category
        <Input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          dir="auto"
          placeholder="e.g. Snacks, Beverages"
        />
      </FieldLabel>

      <FieldLabel>
        Nutrition basis (required)
        <Select
          value={declaredNutritionBasis}
          onChange={(e) => {
            basisSelectedByUser.current = true;
            setDeclaredNutritionBasis(e.target.value as NutritionBasis | '');
          }}
          required
        >
          <option value="">Choose a basis</option>
          <option value="PER_100_G">Per 100 g</option>
          <option value="PER_100_ML">Per 100 ml</option>
        </Select>
      </FieldLabel>

      <div className="grid grid-cols-2 gap-3">
        <FieldLabel>
          Calories / {nutritionBasisLabel} (required)
          <Input
            type="number"
            min={0}
            step="any"
            value={caloriesPer100g}
            onChange={(e) =>
              userEdit('caloriesPer100g', setCaloriesPer100g, e.target.value)
            }
          />
          <ScanHint show={scanFilled.has('caloriesPer100g')} />
        </FieldLabel>
        <FieldLabel>
          Protein / {nutritionBasisLabel} (required)
          <Input
            type="number"
            min={0}
            step="any"
            value={proteinPer100g}
            onChange={(e) =>
              userEdit('proteinPer100g', setProteinPer100g, e.target.value)
            }
          />
          <ScanHint show={scanFilled.has('proteinPer100g')} />
        </FieldLabel>
        <FieldLabel>
          Carbs / {nutritionBasisLabel} (required)
          <Input
            type="number"
            min={0}
            step="any"
            value={carbsPer100g}
            onChange={(e) =>
              userEdit('carbsPer100g', setCarbsPer100g, e.target.value)
            }
          />
          <ScanHint show={scanFilled.has('carbsPer100g')} />
        </FieldLabel>
        <FieldLabel>
          Fat / {nutritionBasisLabel} (required)
          <Input
            type="number"
            min={0}
            step="any"
            value={fatPer100g}
            onChange={(e) =>
              userEdit('fatPer100g', setFatPer100g, e.target.value)
            }
          />
          <ScanHint show={scanFilled.has('fatPer100g')} />
        </FieldLabel>
        <FieldLabel>
          Fiber / {nutritionBasisLabel}
          <Input
            type="number"
            min={0}
            step="any"
            value={fiberPer100g}
            onChange={(e) =>
              userEdit('fiberPer100g', setFiberPer100g, e.target.value)
            }
          />
          <ScanHint show={scanFilled.has('fiberPer100g')} />
        </FieldLabel>
        <FieldLabel>
          Sugar / {nutritionBasisLabel}
          <Input
            type="number"
            min={0}
            step="any"
            value={sugarPer100g}
            onChange={(e) =>
              userEdit('sugarPer100g', setSugarPer100g, e.target.value)
            }
          />
          <ScanHint show={scanFilled.has('sugarPer100g')} />
        </FieldLabel>
        <FieldLabel>
          Sodium (mg) / {nutritionBasisLabel}
          <Input
            type="number"
            min={0}
            step="any"
            value={sodiumMgPer100}
            onChange={(e) =>
              userEdit('sodiumMgPer100', setSodiumMgPer100, e.target.value)
            }
          />
          <ScanHint show={scanFilled.has('sodiumMgPer100')} />
        </FieldLabel>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FieldLabel>
          Serving size
          <Input
            type="number"
            min={0}
            step="any"
            value={servingSize}
            onChange={(e) =>
              userEdit('servingSize', setServingSize, e.target.value)
            }
          />
          <ScanHint show={scanFilled.has('servingSize')} />
        </FieldLabel>
        <FieldLabel>
          Serving unit
          <Input
            value={servingUnit}
            onChange={(e) =>
              userEdit('servingUnit', setServingUnit, e.target.value)
            }
            placeholder="e.g. g, ml"
          />
          <ScanHint show={scanFilled.has('servingUnit')} />
        </FieldLabel>
        <FieldLabel>
          Package size
          <Input
            type="number"
            min={0}
            step="any"
            value={packageSize}
            onChange={(e) =>
              userEdit('packageSize', setPackageSize, e.target.value)
            }
          />
          <ScanHint show={scanFilled.has('packageSize')} />
        </FieldLabel>
        <FieldLabel>
          Package unit
          <Input
            value={packageUnit}
            onChange={(e) =>
              userEdit('packageUnit', setPackageUnit, e.target.value)
            }
            placeholder="e.g. g, ml"
          />
          <ScanHint show={scanFilled.has('packageUnit')} />
        </FieldLabel>
      </div>

      <FieldLabel>
        Country
        <Input
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          placeholder="e.g. Egypt"
        />
      </FieldLabel>

      {error && <p className="text-body text-warn">{error}</p>}

      <div className="flex gap-2">
        <PrimaryButton
          type="submit"
          disabled={submitting}
          className="self-start"
        >
          {submitting ? 'Saving…' : 'Create product'}
        </PrimaryButton>
        {onCancel && (
          <SecondaryButton
            type="button"
            onClick={onCancel}
            className="self-start"
          >
            Cancel
          </SecondaryButton>
        )}
      </div>
    </form>
  );
}
