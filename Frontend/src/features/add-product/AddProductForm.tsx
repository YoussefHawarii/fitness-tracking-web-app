import { useRef, useState } from 'react';
import {
  createPackagedProduct,
  extractNutritionLabel,
  ProductConflictError,
  ProductSubmissionError,
  type NutritionBasis,
  type PackagedProduct,
} from '../../services/foodService';
import { FieldLabel, Input, Select } from '../../components/ui/Input';
import { PrimaryButton, SecondaryButton } from '../../components/ui/Button';
import { completeNutritionLabelExtraction } from './extractionFormValues';
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

  const [labelFile, setLabelFile] = useState<File | null>(null);
  const [labelStatus, setLabelStatus] = useState<
    'idle' | 'extracting' | 'done'
  >('idle');
  const [labelReason, setLabelReason] = useState<string | null>(null);

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

  async function handleExtractLabel() {
    if (!labelFile) return;
    setLabelStatus('extracting');
    setLabelReason(null);
    try {
      await completeNutritionLabelExtraction(extractNutritionLabel(labelFile), {
        applyValues: (values) => {
          if (values.caloriesPer100g !== undefined)
            setCaloriesPer100g(values.caloriesPer100g);
          if (values.proteinPer100g !== undefined)
            setProteinPer100g(values.proteinPer100g);
          if (values.carbsPer100g !== undefined)
            setCarbsPer100g(values.carbsPer100g);
          if (values.fatPer100g !== undefined) setFatPer100g(values.fatPer100g);
          if (values.fiberPer100g !== undefined)
            setFiberPer100g(values.fiberPer100g);
          if (values.sugarPer100g !== undefined)
            setSugarPer100g(values.sugarPer100g);
          if (values.sodiumPer100g !== undefined)
            setSodiumMgPer100(String(Number(values.sodiumPer100g) * 1000));
          if (values.servingSize !== undefined)
            setServingSize(values.servingSize);
          if (values.servingUnit !== undefined)
            setServingUnit(values.servingUnit);
        },
        updateBasis: (resolveBasis) => {
          setDeclaredNutritionBasis((currentBasis) =>
            resolveBasis(currentBasis, basisSelectedByUser.current),
          );
        },
        setUnavailableReason: setLabelReason,
      });
      setLabelStatus('done');
    } catch {
      setLabelStatus('done');
      setLabelReason('Could not process this image.');
    }
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
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => setLabelFile(e.target.files?.[0] ?? null)}
          className="text-body text-text"
        />
        <SecondaryButton
          type="button"
          disabled={!labelFile || labelStatus === 'extracting'}
          onClick={handleExtractLabel}
          className="self-start"
        >
          {labelStatus === 'extracting' ? 'Extracting…' : 'Extract from label'}
        </SecondaryButton>
        {labelReason && (
          <p className="text-body text-text-muted">{labelReason}</p>
        )}
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
            onChange={(e) => setCaloriesPer100g(e.target.value)}
          />
        </FieldLabel>
        <FieldLabel>
          Protein / {nutritionBasisLabel} (required)
          <Input
            type="number"
            min={0}
            step="any"
            value={proteinPer100g}
            onChange={(e) => setProteinPer100g(e.target.value)}
          />
        </FieldLabel>
        <FieldLabel>
          Carbs / {nutritionBasisLabel} (required)
          <Input
            type="number"
            min={0}
            step="any"
            value={carbsPer100g}
            onChange={(e) => setCarbsPer100g(e.target.value)}
          />
        </FieldLabel>
        <FieldLabel>
          Fat / {nutritionBasisLabel} (required)
          <Input
            type="number"
            min={0}
            step="any"
            value={fatPer100g}
            onChange={(e) => setFatPer100g(e.target.value)}
          />
        </FieldLabel>
        <FieldLabel>
          Fiber / {nutritionBasisLabel}
          <Input
            type="number"
            min={0}
            step="any"
            value={fiberPer100g}
            onChange={(e) => setFiberPer100g(e.target.value)}
          />
        </FieldLabel>
        <FieldLabel>
          Sugar / {nutritionBasisLabel}
          <Input
            type="number"
            min={0}
            step="any"
            value={sugarPer100g}
            onChange={(e) => setSugarPer100g(e.target.value)}
          />
        </FieldLabel>
        <FieldLabel>
          Sodium (mg) / {nutritionBasisLabel}
          <Input
            type="number"
            min={0}
            step="any"
            value={sodiumMgPer100}
            onChange={(e) => setSodiumMgPer100(e.target.value)}
          />
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
            onChange={(e) => setServingSize(e.target.value)}
          />
        </FieldLabel>
        <FieldLabel>
          Serving unit
          <Input
            value={servingUnit}
            onChange={(e) => setServingUnit(e.target.value)}
            placeholder="e.g. g, ml"
          />
        </FieldLabel>
        <FieldLabel>
          Package size
          <Input
            type="number"
            min={0}
            step="any"
            value={packageSize}
            onChange={(e) => setPackageSize(e.target.value)}
          />
        </FieldLabel>
        <FieldLabel>
          Package unit
          <Input
            value={packageUnit}
            onChange={(e) => setPackageUnit(e.target.value)}
            placeholder="e.g. g, ml"
          />
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
