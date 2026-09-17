import { useState } from 'react';
import {
  createPackagedProduct,
  extractNutritionLabel,
  ProductConflictError,
  type PackagedProduct,
} from '../../services/foodService';
import { FieldLabel, Input } from '../../components/ui/Input';
import { PrimaryButton, SecondaryButton } from '../../components/ui/Button';

interface Props {
  barcode: string;
  onCreated: (product: PackagedProduct) => void;
  onCancel?: () => void;
}

interface NutritionCandidate {
  caloriesPer100g?: number;
  proteinPer100g?: number;
  carbsPer100g?: number;
  fatPer100g?: number;
  fiberPer100g?: number;
  sugarPer100g?: number;
  sodiumPer100g?: number;
  servingSize?: number;
  servingUnit?: string;
}

export function nutritionCandidateToFormValues(candidate: NutritionCandidate) {
  return Object.fromEntries(
    Object.entries(candidate)
      .filter(([, value]) => value !== undefined)
      .map(([field, value]) => [field, String(value)]),
  );
}

export function validateNonNegative(v: string, label: string): string | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return `${label} must be 0 or more.`;
  return null;
}

export function AddProductForm({ barcode, onCreated, onCancel }: Props) {
  const [name, setName] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState('');
  const [caloriesPer100g, setCaloriesPer100g] = useState('');
  const [proteinPer100g, setProteinPer100g] = useState('');
  const [carbsPer100g, setCarbsPer100g] = useState('');
  const [fatPer100g, setFatPer100g] = useState('');
  const [fiberPer100g, setFiberPer100g] = useState('');
  const [sugarPer100g, setSugarPer100g] = useState('');
  const [sodiumPer100g, setSodiumPer100g] = useState('');
  const [servingSize, setServingSize] = useState('');
  const [servingUnit, setServingUnit] = useState('');
  const [packageSize, setPackageSize] = useState('');
  const [packageUnit, setPackageUnit] = useState('');
  const [country, setCountry] = useState('');

  const [labelFile, setLabelFile] = useState<File | null>(null);
  const [labelStatus, setLabelStatus] = useState<
    'idle' | 'extracting' | 'done'
  >('idle');
  const [labelReason, setLabelReason] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
      const result = await extractNutritionLabel(labelFile);
      setLabelStatus('done');
      if (result.available && result.candidate) {
        const values = nutritionCandidateToFormValues(result.candidate);
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
          setSodiumPer100g(values.sodiumPer100g);
        if (values.servingSize !== undefined)
          setServingSize(values.servingSize);
        if (values.servingUnit !== undefined)
          setServingUnit(values.servingUnit);
      } else if (result.reason) {
        setLabelReason(result.reason);
      }
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
      [sodiumPer100g, 'Sodium'],
    ] as const) {
      const msg = validateNonNegative(val, label);
      if (msg) {
        setError(msg);
        return;
      }
    }

    const fiber = toNumber(fiberPer100g);
    const sugar = toNumber(sugarPer100g);
    const sodium = toNumber(sodiumPer100g);
    const serving = toNumber(servingSize);
    const pkgSize = toNumber(packageSize);

    setSubmitting(true);
    try {
      const product = await createPackagedProduct({
        barcode,
        name: name.trim(),
        ...(nameAr.trim() && { nameAr: nameAr.trim() }),
        ...(brand.trim() && { brand: brand.trim() }),
        ...(category.trim() && { category: category.trim() }),
        caloriesPer100g: cal,
        proteinPer100g: prot,
        carbsPer100g: carb,
        fatPer100g: fat,
        ...(fiber !== undefined && { fiberPer100g: fiber }),
        ...(sugar !== undefined && { sugarPer100g: sugar }),
        ...(sodium !== undefined && { sodiumPer100g: sodium }),
        ...(serving !== undefined && { servingSize: serving }),
        ...(servingUnit.trim() && { servingUnit: servingUnit.trim() }),
        ...(pkgSize !== undefined && { packageSize: pkgSize }),
        ...(packageUnit.trim() && { packageUnit: packageUnit.trim() }),
        ...(country.trim() && { country: country.trim() }),
      });
      onCreated(product);
    } catch (err) {
      if (err instanceof ProductConflictError) {
        setError(
          'A product with this barcode already exists — try scanning again.',
        );
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

      <div className="grid grid-cols-2 gap-3">
        <FieldLabel>
          Calories / 100g (required)
          <Input
            type="number"
            min={0}
            step="any"
            value={caloriesPer100g}
            onChange={(e) => setCaloriesPer100g(e.target.value)}
          />
        </FieldLabel>
        <FieldLabel>
          Protein / 100g (required)
          <Input
            type="number"
            min={0}
            step="any"
            value={proteinPer100g}
            onChange={(e) => setProteinPer100g(e.target.value)}
          />
        </FieldLabel>
        <FieldLabel>
          Carbs / 100g (required)
          <Input
            type="number"
            min={0}
            step="any"
            value={carbsPer100g}
            onChange={(e) => setCarbsPer100g(e.target.value)}
          />
        </FieldLabel>
        <FieldLabel>
          Fat / 100g (required)
          <Input
            type="number"
            min={0}
            step="any"
            value={fatPer100g}
            onChange={(e) => setFatPer100g(e.target.value)}
          />
        </FieldLabel>
        <FieldLabel>
          Fiber / 100g
          <Input
            type="number"
            min={0}
            step="any"
            value={fiberPer100g}
            onChange={(e) => setFiberPer100g(e.target.value)}
          />
        </FieldLabel>
        <FieldLabel>
          Sugar / 100g
          <Input
            type="number"
            min={0}
            step="any"
            value={sugarPer100g}
            onChange={(e) => setSugarPer100g(e.target.value)}
          />
        </FieldLabel>
        <FieldLabel>
          Sodium / 100g
          <Input
            type="number"
            min={0}
            step="any"
            value={sodiumPer100g}
            onChange={(e) => setSodiumPer100g(e.target.value)}
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
