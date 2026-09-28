import { useCallback, useEffect, useRef, useState, type Ref } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { isAxiosError } from 'axios';
import { BarcodeScanner } from '../features/barcode-scanner/BarcodeScanner';
import { VoiceLogger } from '../features/voice-logger/VoiceLogger';
import { ManualFoodSearch } from '../features/manual-food-search/ManualFoodSearch';
import { AddProductForm } from '../features/add-product/AddProductForm';
import { PortionSelector } from '../features/portion-selector/PortionSelector';
import { buildEditPortionOptions } from '../features/portion-selector/editPortionOptions';
import {
  buildPortionCreatePayload,
  calculatePortionNutrition,
  isValidPortionAmountInput,
  type PortionNutrition,
} from '../features/portion-selector/portionCalculations';
import {
  baseUnitForResolution,
  buildPortionOptions,
  type LoggableBarcodeResolution,
  type PortionOptionId,
  type PortionOptionsResult,
} from '../features/portion-selector/portionOptions';
import {
  createFoodLog,
  deleteFoodLog,
  formatEntryAmount,
  getPackagedProduct,
  getEditPrefill,
  listFoodLogsForDay,
  lookupBarcode,
  updateFoodLog,
  InvalidBarcodeError,
  type FoodMatch,
  type FoodSourceType,
  type BaseUnit,
  type BarcodeResolution,
  type LocalFoodItem,
  type MealCategory,
  type NotLoggableReason,
  type PackagedProduct,
} from '../services/foodService';
import { Card, SegmentedControl } from '../components/ui/Card';
import { Input, FieldLabel, Select } from '../components/ui/Input';
import { PrimaryButton, SecondaryButton } from '../components/ui/Button';
import {
  EditIcon,
  MicIcon,
  PlusCircleIcon,
  ScanIcon,
  TrashIcon,
} from '../components/ui/icons';
import { useAccountTimezone } from '../hooks/useAccountTimezone';

type InputMode = 'barcode' | 'voice' | 'manual';
export type PendingItem = {
  sourceType: FoodSourceType;
  sourceRef: string;
  name: string;
  caloriesPer100g: number;
  proteinPer100g?: number | null;
  carbsPer100g?: number | null;
  fatPer100g?: number | null;
  nameAr?: string | null;
  brand?: string | null;
  imageUrl?: string | null;
  packageSize?: number | null;
  packageUnit?: string | null;
  verificationStatus?: PackagedProduct['verificationStatus'] | null;
  resolution?: BarcodeResolution;
};

type ScanStatus =
  | 'idle'
  | 'looking-up'
  | 'found'
  | 'not-loggable'
  | 'not-found'
  | 'invalid'
  | 'unavailable'
  | 'scanner-failed';

interface FoodLogEntry {
  id: string;
  sourceType: FoodSourceType;
  sourceRef: string;
  packagedProductId?: string | null;
  name: string;
  grams: string | null;
  amount?: string | null;
  amountUnit?: 'G' | 'ML' | null;
  portionKind?: 'PACKAGE' | 'SERVING' | 'CUSTOM' | null;
  portionMultiplier?: string | null;
  caloriesComputed: string;
  mealCategory: MealCategory;
  loggedAtUtc: string;
}

const MEAL_ORDER: MealCategory[] = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACKS'];
const MAX_AUTOMATIC_SCAN_RESTARTS = 2;
const SCAN_RESTART_DELAY_MS = 350;

function isInputMode(value: unknown): value is InputMode {
  return value === 'barcode' || value === 'voice' || value === 'manual';
}

function toPendingItem(match: FoodMatch): PendingItem {
  return {
    sourceType: match.sourceType,
    sourceRef: match.sourceRef,
    name: match.name,
    caloriesPer100g: match.caloriesPer100g,
  };
}

function toPackagedPendingItem(product: PackagedProduct): PendingItem {
  return {
    sourceType: 'PACKAGED_PRODUCT',
    sourceRef: product.id,
    name: product.name,
    caloriesPer100g: product.caloriesPer100g,
    proteinPer100g: product.proteinPer100g,
    carbsPer100g: product.carbsPer100g,
    fatPer100g: product.fatPer100g,
    nameAr: product.nameAr,
    brand: product.brand,
    imageUrl: product.imageUrl,
    packageSize: product.packageSize,
    packageUnit: product.packageUnit,
    verificationStatus: product.verificationStatus,
    resolution: product.resolution,
  };
}

function getPendingAmountUnit(item: PendingItem): BaseUnit {
  if (item.resolution?.outcome === 'LOGGABLE') {
    return item.resolution.effectiveNutritionBasis.basis === 'PER_100_ML'
      ? 'ML'
      : 'G';
  }
  return 'G';
}

function nutritionBasisText(item: PendingItem): string {
  if (item.resolution?.outcome === 'LOGGABLE') {
    return item.resolution.effectiveNutritionBasis.basis === 'PER_100_ML'
      ? `${item.caloriesPer100g} kcal / 100 ml`
      : `${item.caloriesPer100g} kcal / 100 g`;
  }
  return `${item.caloriesPer100g} kcal/100g`;
}

function defaultPortionOptionId(
  item: PendingItem | undefined,
): PortionOptionId | null {
  const resolution =
    item?.sourceType === 'PACKAGED_PRODUCT' &&
    item.resolution?.outcome === 'LOGGABLE'
      ? item.resolution
      : null;
  return resolution
    ? (buildPortionOptions(resolution).defaultSelection?.optionId ?? null)
    : null;
}

export function PendingAmountFields({
  item,
  amount,
  onAmountChange,
  inputRef,
}: {
  item: PendingItem;
  amount: string;
  onAmountChange: (value: string) => void;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const unit = getPendingAmountUnit(item);
  const unitLabel = unit === 'ML' ? 'ml' : 'g';
  return (
    <>
      <p className="text-body text-text-muted">{nutritionBasisText(item)}</p>
      <FieldLabel>
        Amount ({unitLabel})
        <Input
          ref={inputRef}
          type="number"
          min={0.1}
          step={0.1}
          value={amount}
          onChange={(event) => onAmountChange(event.target.value)}
        />
      </FieldLabel>
    </>
  );
}

function displayNutrient(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
}

function PortionNutritionPreview({
  nutrition,
}: {
  nutrition: PortionNutrition | null;
}) {
  if (nutrition === null) {
    return (
      <p className="text-body text-text-muted">
        Select a valid portion to preview calories and macros.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="mb-2 text-label text-text-muted normal-case tracking-normal">
        This portion
      </p>
      <div className="grid grid-cols-2 gap-2 text-body text-text sm:grid-cols-4">
        <span>{displayNutrient(nutrition.calories)} kcal</span>
        <span>
          {nutrition.protein != null
            ? `${displayNutrient(nutrition.protein)} g protein`
            : 'Protein: not available'}
        </span>
        <span>
          {nutrition.carbs != null
            ? `${displayNutrient(nutrition.carbs)} g carbs`
            : 'Carbs: not available'}
        </span>
        <span>
          {nutrition.fat != null
            ? `${displayNutrient(nutrition.fat)} g fat`
            : 'Fat: not available'}
        </span>
      </div>
    </div>
  );
}

export function EditAmountField({
  entry,
  value,
  onChange,
}: {
  entry: FoodLogEntry;
  value: string;
  onChange: (value: string) => void;
}) {
  const isMillilitreEntry = entry.amountUnit === 'ML';
  return (
    <FieldLabel>
      Amount ({isMillilitreEntry ? 'ml' : 'g'})
      <Input
        type="number"
        min={0.1}
        step={0.1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </FieldLabel>
  );
}

export function HistoryAmount({ entry }: { entry: FoodLogEntry }) {
  return <>{formatEntryAmount(entry)}</>;
}

const SAVE_REJECTION_MESSAGES: Record<string, string> = {
  AMOUNT_UNIT_BASIS_MISMATCH:
    "The amount unit does not match this product's nutrition basis.",
  MASS_SOURCE_REQUIRES_G: 'This food can only be logged in grams.',
  PACKAGE_PORTION_UNAVAILABLE: 'This product has no usable package size.',
  SERVING_PORTION_UNAVAILABLE: 'This product has no usable serving size.',
  PORTION_AMOUNT_MISMATCH:
    'The amount does not match the selected package or serving.',
  PORTION_DIMENSION_UNKNOWN:
    'This product does not have a usable portion unit.',
  NUTRITION_BASIS_UNKNOWN:
    'This product does not have a usable nutrition basis.',
  DIMENSION_BASIS_CONFLICT:
    "This product's portion unit conflicts with its nutrition basis.",
  OPEN_FOOD_FACTS_CREATE_RETIRED: 'Scan this barcode again before saving it.',
};

function foodLogSaveErrorMessage(error: unknown): string {
  if (!isAxiosError(error)) return 'Could not save this entry.';
  const data = error.response?.data as
    { reason?: unknown; message?: unknown } | undefined;
  const nested =
    typeof data?.message === 'object' && data.message !== null
      ? (data.message as { reason?: unknown })
      : undefined;
  const reason =
    typeof data?.reason === 'string'
      ? data.reason
      : typeof nested?.reason === 'string'
        ? nested.reason
        : undefined;
  if (reason && SAVE_REJECTION_MESSAGES[reason]) {
    return SAVE_REJECTION_MESSAGES[reason];
  }
  if (typeof data?.message === 'string') return data.message;
  return 'Could not save this entry.';
}

export function PackagedProductPreview({ product }: { product: PendingItem }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        {product.imageUrl && (
          <img
            src={product.imageUrl}
            alt={product.name}
            className="h-16 w-16 shrink-0 rounded-lg object-cover"
          />
        )}
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-2 text-label text-accent normal-case tracking-normal">
            ✓ Found: {product.name}
          </p>
          {product.nameAr && (
            <p className="text-body text-text-muted" dir="auto">
              {product.nameAr}
            </p>
          )}
          {product.brand && (
            <p className="text-body text-text-muted">{product.brand}</p>
          )}
          {product.packageSize != null && (
            <p className="text-body text-text-muted">
              {product.packageSize}
              {product.packageUnit ? ` ${product.packageUnit}` : ''}
            </p>
          )}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2 text-body text-text-muted">
        <span>{product.caloriesPer100g} kcal</span>
        <span>
          {product.proteinPer100g != null
            ? `${product.proteinPer100g}g protein`
            : 'Protein: not available'}
        </span>
        <span>
          {product.carbsPer100g != null
            ? `${product.carbsPer100g}g carbs`
            : 'Carbs: not available'}
        </span>
        <span>
          {product.fatPer100g != null
            ? `${product.fatPer100g}g fat`
            : 'Fat: not available'}
        </span>
      </div>
      {product.verificationStatus &&
        product.verificationStatus !== 'EXTERNAL' && (
          <p className="text-label text-text-muted normal-case tracking-normal">
            {product.verificationStatus === 'VERIFIED'
              ? 'Verified'
              : 'Community submitted'}
          </p>
        )}
    </div>
  );
}

export function BarcodeNotFoundActions({
  onAdd,
  onSearch,
  onRescan,
}: {
  onAdd: () => void;
  onSearch: () => void;
  onRescan: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <p className="text-body">We couldn't find a product for that barcode.</p>
      <div className="flex flex-wrap gap-2">
        <PrimaryButton type="button" onClick={onAdd}>
          Add this product
        </PrimaryButton>
        <SecondaryButton type="button" onClick={onSearch}>
          Search manually instead
        </SecondaryButton>
        <SecondaryButton type="button" onClick={onRescan}>
          Scan again
        </SecondaryButton>
      </div>
    </div>
  );
}

const NOT_LOGGABLE_EXPLANATIONS: Record<NotLoggableReason, string> = {
  DIMENSION_BASIS_CONFLICT:
    "This product's portion unit conflicts with its nutrition basis, so it can't be logged safely.",
  PORTION_DIMENSION_UNKNOWN:
    "This product doesn't include a usable package or serving unit, so it can't be logged safely.",
  NUTRITION_BASIS_UNKNOWN:
    "The nutrition information doesn't say whether values are per 100 g or per 100 ml, so this product can't be logged safely.",
};

type NotLoggableResolution = Extract<
  NonNullable<PackagedProduct['resolution']>,
  { outcome: 'NOT_LOGGABLE' }
>;

export function NotLoggableProductPanel({
  resolution,
  onAdd,
  onSearch,
  onRescan,
}: {
  resolution: NotLoggableResolution;
  onAdd: () => void;
  onSearch: () => void;
  onRescan: () => void;
}) {
  const { display } = resolution;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-warn bg-surface p-4">
      <div className="flex items-start gap-3">
        {display.imageUrl && (
          <img
            src={display.imageUrl}
            alt={display.name}
            className="h-16 w-16 shrink-0 rounded-lg object-cover"
          />
        )}
        <div className="flex flex-col gap-1">
          <p className="text-heading">{display.name}</p>
          {display.brand && (
            <p className="text-body text-text-muted">{display.brand}</p>
          )}
        </div>
      </div>
      <p className="text-body text-warn">
        {NOT_LOGGABLE_EXPLANATIONS[resolution.primaryReason]}
      </p>
      <div className="flex flex-wrap gap-2">
        {resolution.subjectKind !== 'PACKAGED_PRODUCT' && (
          <PrimaryButton type="button" onClick={onAdd}>
            Add this product
          </PrimaryButton>
        )}
        <SecondaryButton type="button" onClick={onSearch}>
          Search manually instead
        </SecondaryButton>
        <SecondaryButton type="button" onClick={onRescan}>
          Scan again
        </SecondaryButton>
      </div>
    </div>
  );
}

export function FoodLog() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { todayInAccountTimezone } = useAccountTimezone();
  const date = searchParams.get('date') || todayInAccountTimezone();
  const requestedMode = (location.state as { mode?: unknown } | null)?.mode;
  const [mode, setMode] = useState<InputMode>(
    isInputMode(requestedMode) ? requestedMode : 'barcode',
  );

  // A queue rather than a single item so a voice recording that splits into
  // several food terms ("chicken and rice") can be logged one at a time
  // without losing the rest — see docs/food-log-input-modes-diagnosis.md §2.3.
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const pendingItem = pendingItems[0] ?? null;
  const pendingCardRef = useRef<HTMLDivElement>(null);
  const amountInputRef = useRef<HTMLInputElement>(null);

  const [amountInput, setAmountInput] = useState('');
  const [selectedPortionOptionId, setSelectedPortionOptionId] =
    useState<PortionOptionId | null>(null);
  const [mealCategory, setMealCategory] = useState<MealCategory>('BREAKFAST');
  const [status, setStatus] = useState<string | null>(null);
  const [entries, setEntries] = useState<FoodLogEntry[]>([]);

  // Barcode scan state machine — see docs/food-log-input-modes-diagnosis.md
  // §1.4/§1.6: a successful scan needs its own visible "found"/"not found"
  // states inside the scan card itself, not just a muted caption below it.
  const [scanStatus, setScanStatus] = useState<ScanStatus>('idle');
  const [lastScannedBarcode, setLastScannedBarcode] = useState<string | null>(
    null,
  );
  const [scanAttempt, setScanAttempt] = useState(0);
  const automaticScanRestartCountRef = useRef(0);
  const scanRestartTimerRef = useRef<ReturnType<
    typeof window.setTimeout
  > | null>(null);
  // Bumped on every new scan attempt (and whenever the user leaves the scan
  // in progress) so a lookup abandoned by a rescan/mode-switch can't apply
  // its result after something newer has already taken its place.
  const scanRequestIdRef = useRef(0);
  const [manualBarcodeContext, setManualBarcodeContext] = useState<{
    barcode: string;
    kind: 'not-found' | 'not-loggable';
  } | null>(null);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [notLoggableResolution, setNotLoggableResolution] =
    useState<NotLoggableResolution | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editGrams, setEditGrams] = useState('');
  const [editMeal, setEditMeal] = useState<MealCategory>('BREAKFAST');
  const [editError, setEditError] = useState<string | null>(null);
  const [editProduct, setEditProduct] = useState<PackagedProduct | null>(null);
  const [editProductLoading, setEditProductLoading] = useState(false);
  const [editPortionModel, setEditPortionModel] =
    useState<PortionOptionsResult | null>(null);
  const [editPortionOptionId, setEditPortionOptionId] =
    useState<PortionOptionId | null>(null);
  const [editAmountDirty, setEditAmountDirty] = useState(false);
  const editProductRequestIdRef = useRef(0);

  const loggableResolution: LoggableBarcodeResolution | null =
    pendingItem?.sourceType === 'PACKAGED_PRODUCT' &&
    pendingItem.resolution?.outcome === 'LOGGABLE'
      ? pendingItem.resolution
      : null;
  const portionModel = loggableResolution
    ? buildPortionOptions(loggableResolution)
    : null;
  const selectedPortionOption = portionModel?.options.find(
    ({ id }) => id === selectedPortionOptionId,
  );
  const portionCreatePayload = loggableResolution
    ? buildPortionCreatePayload(
        loggableResolution,
        selectedPortionOption?.choice ?? null,
        amountInput,
      )
    : null;
  const portionNutritionPreview =
    portionCreatePayload && pendingItem
      ? calculatePortionNutrition(pendingItem, portionCreatePayload.amount)
      : null;
  const packagedPortionInvalid =
    loggableResolution !== null && portionCreatePayload === null;
  const editResolution: LoggableBarcodeResolution | null =
    editProduct?.resolution?.outcome === 'LOGGABLE'
      ? editProduct.resolution
      : null;
  const editPortionOption = editPortionModel?.options.find(
    ({ id }) => id === editPortionOptionId,
  );
  const editPortionPayload = editResolution
    ? buildPortionCreatePayload(
        editResolution,
        editPortionOption?.choice ?? null,
        editGrams,
      )
    : null;
  const editNutritionPreview =
    editProduct && editPortionPayload
      ? calculatePortionNutrition(editProduct, editPortionPayload.amount)
      : null;

  function replacePendingItems(items: PendingItem[]) {
    setPendingItems(items);
    setAmountInput('');
    setSelectedPortionOptionId(defaultPortionOptionId(items[0]));
  }

  const refreshEntries = useCallback(() => {
    listFoodLogsForDay(date)
      .then(setEntries)
      .catch(() => undefined);
  }, [date]);

  useEffect(() => {
    refreshEntries();
  }, [refreshEntries]);

  useEffect(
    () => () => {
      if (scanRestartTimerRef.current !== null) {
        window.clearTimeout(scanRestartTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (pendingItems.length > 0) {
      pendingCardRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
      // Selecting an item (scan/voice/manual) means amount is the very next
      // thing to fill in — see docs/food-log-input-modes-diagnosis.md §1.6
      // item 5.
      amountInputRef.current?.focus();
    }
  }, [pendingItems.length]);

  function startEdit(entry: FoodLogEntry) {
    const requestId = ++editProductRequestIdRef.current;
    setEditingId(entry.id);
    setEditGrams(getEditPrefill(entry));
    setEditMeal(entry.mealCategory);
    setEditError(null);
    setEditProduct(null);
    setEditProductLoading(entry.sourceType === 'PACKAGED_PRODUCT');
    setEditPortionModel(null);
    setEditPortionOptionId(null);
    setEditAmountDirty(false);

    if (entry.sourceType !== 'PACKAGED_PRODUCT') return;
    getPackagedProduct(entry.packagedProductId ?? entry.sourceRef)
      .then((product) => {
        if (editProductRequestIdRef.current !== requestId) return;
        setEditProductLoading(false);
        setEditProduct(product);
        if (product.resolution?.outcome !== 'LOGGABLE') return;
        const model = buildEditPortionOptions(entry, product.resolution);
        setEditPortionModel(model);
        setEditPortionOptionId(model.defaultSelection?.optionId ?? null);
      })
      .catch(() => {
        if (editProductRequestIdRef.current !== requestId) return;
        setEditProductLoading(false);
        setEditError('This product is no longer available for editing.');
      });
  }

  function cancelEdit() {
    editProductRequestIdRef.current += 1;
    setEditingId(null);
    setEditError(null);
    setEditProduct(null);
    setEditProductLoading(false);
    setEditPortionModel(null);
    setEditPortionOptionId(null);
  }

  async function saveEdit(id: string) {
    const entry = entries.find((item) => item.id === id);
    if (!entry) return;
    if (!editAmountDirty) {
      try {
        await updateFoodLog(id, { mealCategory: editMeal });
        setEditingId(null);
        setEditError(null);
        refreshEntries();
      } catch (error) {
        setEditError(foodLogSaveErrorMessage(error));
      }
      return;
    }

    let amountPayload:
      | {
          amount: number;
          amountUnit: BaseUnit;
          portionKind: 'PACKAGE' | 'SERVING';
          portionMultiplier: number;
        }
      | {
          amount: number;
          amountUnit: BaseUnit;
          portionKind: 'CUSTOM';
        };
    if (editResolution) {
      if (!editPortionPayload) {
        setEditError(
          'Choose a portion and enter a valid amount with at most one decimal place.',
        );
        return;
      }
      amountPayload = editPortionPayload;
    } else {
      if (!isValidPortionAmountInput(editGrams)) {
        setEditError(
          'Enter a valid amount greater than 0 with at most one decimal place.',
        );
        return;
      }
      amountPayload = {
        amount: Number(editGrams),
        amountUnit: entry.amountUnit ?? 'G',
        portionKind: 'CUSTOM',
      };
    }

    if (!Number.isFinite(amountPayload.amount) || amountPayload.amount <= 0) {
      setEditError('Enter a valid amount greater than 0.');
      return;
    }
    try {
      await updateFoodLog(id, { ...amountPayload, mealCategory: editMeal });
      setEditingId(null);
      setEditError(null);
      refreshEntries();
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 404) {
        setStatus('That item was already removed — refreshing the list.');
        setEditingId(null);
        refreshEntries();
        return;
      }
      setEditError(foodLogSaveErrorMessage(err));
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Remove this food entry?')) return;
    try {
      await deleteFoodLog(id);
      refreshEntries();
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 404) {
        setStatus('That item was already removed — refreshing the list.');
      } else {
        setStatus('Could not delete this entry.');
      }
      refreshEntries();
    }
  }

  async function handleBarcodeDecoded(barcode: string) {
    if (scanStatus === 'looking-up') return; // single-flight guard
    cancelPendingScanRestart();
    const requestId = ++scanRequestIdRef.current;
    setLastScannedBarcode(barcode);
    setScanStatus('looking-up');
    try {
      const product = await lookupBarcode(barcode);
      if (scanRequestIdRef.current !== requestId) return; // superseded by a rescan/mode-switch
      if (!product) {
        setScanStatus('not-found');
        return;
      }
      if (product.resolution?.outcome === 'NOT_LOGGABLE') {
        replacePendingItems([]);
        setNotLoggableResolution(product.resolution);
        setScanStatus('not-loggable');
        setStatus(null);
        return;
      }
      replacePendingItems([toPackagedPendingItem(product)]);
      setNotLoggableResolution(null);
      setScanStatus('found');
      setStatus(null);
    } catch (error) {
      if (scanRequestIdRef.current !== requestId) return;
      if (error instanceof InvalidBarcodeError) {
        setScanStatus('invalid');
        return;
      }
      setScanStatus('unavailable');
    }
  }

  function retryLastScan() {
    automaticScanRestartCountRef.current = 0;
    cancelPendingScanRestart();
    if (lastScannedBarcode) {
      handleBarcodeDecoded(lastScannedBarcode);
    }
  }

  function rescan() {
    automaticScanRestartCountRef.current = 0;
    cancelPendingScanRestart();
    scanRequestIdRef.current++; // invalidate any lookup still in flight
    setScanStatus('idle');
    setLastScannedBarcode(null);
    setScanAttempt((n) => n + 1);
    setShowAddProduct(false);
    setNotLoggableResolution(null);
  }

  function cancelPendingScanRestart() {
    if (scanRestartTimerRef.current === null) return;
    window.clearTimeout(scanRestartTimerRef.current);
    scanRestartTimerRef.current = null;
  }

  function handleScannerError() {
    if (automaticScanRestartCountRef.current >= MAX_AUTOMATIC_SCAN_RESTARTS) {
      setScanStatus('scanner-failed');
      return;
    }

    automaticScanRestartCountRef.current += 1;
    scanRestartTimerRef.current = window.setTimeout(() => {
      scanRestartTimerRef.current = null;
      setScanAttempt((n) => n + 1);
    }, SCAN_RESTART_DELAY_MS);
  }

  // Re-entering the Scan tab should always show a fresh camera view, not a
  // leftover "not found"/"unavailable" banner from a previous visit.
  function handleModeChange(newMode: InputMode) {
    if (newMode === 'barcode' && mode !== 'barcode') {
      rescan();
    }
    if (mode === 'barcode' && newMode !== 'barcode') {
      cancelPendingScanRestart();
      if (scanStatus === 'looking-up') {
        scanRequestIdRef.current++; // leaving mid-lookup invalidates it too
      }
    }
    if (newMode !== 'manual') {
      setManualBarcodeContext(null);
    }
    setMode(newMode);
  }

  function handleFoodMatchSelected(match: FoodMatch) {
    replacePendingItems([toPendingItem(match)]);
    setStatus(null);
  }

  function handleFoodMatchesSelected(matches: FoodMatch[]) {
    if (matches.length === 0) return;
    replacePendingItems(matches.map(toPendingItem));
    setStatus(null);
  }

  function handleLocalItemCreated(item: LocalFoodItem) {
    replacePendingItems([
      {
        sourceType: 'LOCAL',
        sourceRef: item.id,
        name: item.name,
        caloriesPer100g: item.caloriesPer100g,
      },
    ]);
    setStatus(null);
  }

  function handleProductCreated(product: PackagedProduct) {
    replacePendingItems([toPackagedPendingItem(product)]);
    setNotLoggableResolution(null);
    setShowAddProduct(false);
    setScanStatus('found');
    setStatus(null);
  }

  async function handleSaveLog() {
    const current = pendingItems[0];
    if (loggableResolution && !selectedPortionOption) {
      setStatus('Choose a portion before saving.');
      return;
    }
    if (
      selectedPortionOption?.choice.portionKind === 'CUSTOM' &&
      !portionCreatePayload
    ) {
      setStatus('Enter a valid custom amount with at most one decimal place.');
      return;
    }

    if (!current || (loggableResolution && !portionCreatePayload)) {
      setStatus(
        'Choose a food item and enter a valid amount with at most one decimal place.',
      );
      return;
    }
    if (!loggableResolution && !isValidPortionAmountInput(amountInput)) {
      setStatus(
        'Choose a food item and enter a valid amount with at most one decimal place.',
      );
      return;
    }
    try {
      const amountPayload =
        loggableResolution && portionCreatePayload
          ? portionCreatePayload
          : {
              amount: Number(amountInput),
              amountUnit: getPendingAmountUnit(current),
              ...(current.sourceType === 'PACKAGED_PRODUCT'
                ? ({ portionKind: 'CUSTOM' } as const)
                : {}),
            };
      await createFoodLog({
        sourceType: current.sourceType,
        sourceRef: current.sourceRef,
        name: current.sourceType === 'CANONICAL' ? current.name : undefined,
        ...amountPayload,
        mealCategory,
        loggedAtUtc: new Date().toISOString(),
      });
      const remaining = pendingItems.length - 1;
      setStatus(
        remaining > 0
          ? `Logged ${current.name} under ${mealCategory}. ${remaining} more item${remaining === 1 ? '' : 's'} to log.`
          : `Logged ${current.name} under ${mealCategory}.`,
      );
      const stillQueued = remaining > 0;
      const nextPendingItem = pendingItems[1];
      setPendingItems((prev) => prev.slice(1));
      setAmountInput('');
      setSelectedPortionOptionId(defaultPortionOptionId(nextPendingItem));
      refreshEntries();
      // A scanned item was just saved and nothing else is queued — return
      // the scan card to a ready-to-scan-again state instead of leaving the
      // stale "✓ Found" caption's camera box sitting there blank.
      if (current.sourceType === 'PACKAGED_PRODUCT' && !stillQueued) {
        rescan();
      }
    } catch (error) {
      setStatus(foodLogSaveErrorMessage(error));
    }
  }

  const grouped = MEAL_ORDER.map((meal) => {
    const items = entries.filter((e) => e.mealCategory === meal);
    const total = items.reduce((sum, e) => sum + Number(e.caloriesComputed), 0);
    return { meal, items, total };
  }).filter((g) => g.items.length > 0 || g.meal !== 'SNACKS');

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-display">Log food</h1>

      <SegmentedControl
        value={mode}
        onChange={handleModeChange}
        options={[
          { value: 'barcode', label: 'Scan' },
          { value: 'voice', label: 'Voice' },
          { value: 'manual', label: 'Manual' },
        ]}
      />

      <Card className="p-6">
        {mode === 'barcode' && (
          <div className="flex flex-col gap-3">
            <div className="hud-frame overflow-hidden rounded-xl bg-black">
              {scanStatus !== 'not-found' &&
                scanStatus !== 'not-loggable' &&
                scanStatus !== 'invalid' &&
                scanStatus !== 'unavailable' &&
                scanStatus !== 'scanner-failed' && (
                  <BarcodeScanner
                    key={scanAttempt}
                    onDecoded={handleBarcodeDecoded}
                    onScanError={handleScannerError}
                  />
                )}
              {(scanStatus === 'not-found' ||
                scanStatus === 'not-loggable' ||
                scanStatus === 'invalid' ||
                scanStatus === 'unavailable' ||
                scanStatus === 'scanner-failed') && (
                <div className="flex aspect-square w-full items-center justify-center bg-black" />
              )}
            </div>

            {scanStatus === 'idle' && (
              <p className="flex items-center gap-2 text-label text-text-muted normal-case tracking-normal">
                <ScanIcon width={16} height={16} /> Align barcode within frame
              </p>
            )}
            {scanStatus === 'looking-up' && (
              <p className="flex items-center gap-2 text-label text-text-muted normal-case tracking-normal">
                <ScanIcon width={16} height={16} /> Barcode detected — looking
                it up…
              </p>
            )}
            {scanStatus === 'found' &&
              pendingItem?.sourceType === 'PACKAGED_PRODUCT' && (
                <PackagedProductPreview product={pendingItem} />
              )}
            {scanStatus === 'not-loggable' &&
              notLoggableResolution &&
              !showAddProduct && (
                <NotLoggableProductPanel
                  resolution={notLoggableResolution}
                  onAdd={() => setShowAddProduct(true)}
                  onSearch={() => {
                    setManualBarcodeContext(
                      lastScannedBarcode
                        ? {
                            barcode: lastScannedBarcode,
                            kind: 'not-loggable',
                          }
                        : null,
                    );
                    setMode('manual');
                  }}
                  onRescan={rescan}
                />
              )}
            {scanStatus === 'not-found' && !showAddProduct && (
              <BarcodeNotFoundActions
                onAdd={() => setShowAddProduct(true)}
                onSearch={() => {
                  setManualBarcodeContext(
                    lastScannedBarcode
                      ? { barcode: lastScannedBarcode, kind: 'not-found' }
                      : null,
                  );
                  setMode('manual');
                }}
                onRescan={rescan}
              />
            )}
            {(scanStatus === 'not-found' || scanStatus === 'not-loggable') &&
              showAddProduct && (
                <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
                  <AddProductForm
                    barcode={lastScannedBarcode ?? ''}
                    onCreated={handleProductCreated}
                    onCancel={() => setShowAddProduct(false)}
                  />
                </div>
              )}
            {scanStatus === 'unavailable' && (
              <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
                <p className="text-body text-warn">
                  Couldn't check that barcode right now — try again in a moment.
                </p>
                <div className="flex flex-wrap gap-2">
                  <PrimaryButton type="button" onClick={retryLastScan}>
                    Try again
                  </PrimaryButton>
                  <SecondaryButton
                    type="button"
                    onClick={() => setMode('manual')}
                  >
                    Search manually instead
                  </SecondaryButton>
                </div>
              </div>
            )}
            {scanStatus === 'invalid' && (
              <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
                <p className="text-body text-warn">
                  That barcode is invalid or damaged. Scan it again or enter the
                  product manually.
                </p>
                <div className="flex flex-wrap gap-2">
                  <PrimaryButton type="button" onClick={rescan}>
                    Scan again
                  </PrimaryButton>
                  <SecondaryButton
                    type="button"
                    onClick={() => setMode('manual')}
                  >
                    Search manually instead
                  </SecondaryButton>
                </div>
              </div>
            )}
            {scanStatus === 'scanner-failed' && (
              <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
                <p className="text-body text-warn">
                  The scanner had trouble reading camera frames — try again in a
                  moment.
                </p>
                <div className="flex flex-wrap gap-2">
                  <PrimaryButton type="button" onClick={rescan}>
                    Try again
                  </PrimaryButton>
                  <SecondaryButton
                    type="button"
                    onClick={() => setMode('manual')}
                  >
                    Search manually instead
                  </SecondaryButton>
                </div>
              </div>
            )}
          </div>
        )}
        {mode === 'voice' && (
          <div className="flex flex-col gap-3">
            <p className="flex items-center gap-2 text-label text-text-muted normal-case tracking-normal">
              <MicIcon width={16} height={16} /> Say what you ate
            </p>
            <VoiceLogger onMatchesSelected={handleFoodMatchesSelected} />
          </div>
        )}
        {mode === 'manual' && (
          <div className="flex flex-col gap-3">
            <p className="flex items-center gap-2 text-label text-text-muted normal-case tracking-normal">
              <PlusCircleIcon width={16} height={16} /> Add a food item
            </p>
            {manualBarcodeContext && (
              <p className="text-body text-text-muted">
                {manualBarcodeContext.kind === 'not-found' ? (
                  <>
                    Barcode {manualBarcodeContext.barcode} wasn't found — search
                    for the product by name instead.
                  </>
                ) : (
                  <>
                    Barcode {manualBarcodeContext.barcode} can't be logged
                    safely — search for the product by name instead.
                  </>
                )}
              </p>
            )}
            <ManualFoodSearch
              onMatchSelected={handleFoodMatchSelected}
              onLocalItemCreated={handleLocalItemCreated}
            />
          </div>
        )}
      </Card>

      {pendingItem && (
        <div ref={pendingCardRef}>
          <Card className="flex flex-col gap-3 p-6">
            {pendingItems.length > 1 && (
              <p className="text-label text-text-muted normal-case tracking-normal">
                Item 1 of {pendingItems.length} to log
              </p>
            )}
            <p className="text-heading">{pendingItem.name}</p>
            {portionModel && loggableResolution ? (
              <>
                <p className="text-body text-text-muted">
                  {nutritionBasisText(pendingItem)}
                </p>
                <PortionSelector
                  options={portionModel.options}
                  selectedOptionId={selectedPortionOptionId}
                  customAmount={amountInput}
                  baseUnit={baseUnitForResolution(loggableResolution)}
                  onSelectionChange={(optionId) => {
                    setSelectedPortionOptionId(optionId);
                    setStatus(null);
                  }}
                  onCustomAmountChange={setAmountInput}
                  customInputRef={amountInputRef}
                />
                <PortionNutritionPreview nutrition={portionNutritionPreview} />
              </>
            ) : (
              <PendingAmountFields
                item={pendingItem}
                amount={amountInput}
                onAmountChange={setAmountInput}
                inputRef={amountInputRef}
              />
            )}
            <FieldLabel>
              Meal
              <Select
                value={mealCategory}
                onChange={(e) =>
                  setMealCategory(e.target.value as MealCategory)
                }
              >
                <option value="BREAKFAST">Breakfast</option>
                <option value="LUNCH">Lunch</option>
                <option value="DINNER">Dinner</option>
                <option value="SNACKS">Snacks</option>
              </Select>
            </FieldLabel>
            <PrimaryButton
              onClick={handleSaveLog}
              disabled={packagedPortionInvalid}
              className="self-start"
            >
              Save entry
            </PrimaryButton>
          </Card>
        </div>
      )}

      {status && <p className="text-body text-text-muted">{status}</p>}

      <div className="flex flex-col gap-4">
        {grouped.map(({ meal, items, total }) => (
          <div key={meal}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-label text-text-muted">{meal}</span>
              {items.length > 0 && (
                <span className="text-readout text-xs text-text-muted">
                  {total.toFixed(0)} KCAL
                </span>
              )}
            </div>
            <Card className="divide-y divide-border">
              {items.length === 0 ? (
                <p className="p-4 text-body text-text-muted">
                  No items logged.
                </p>
              ) : (
                items.map((item) =>
                  editingId === item.id ? (
                    <div
                      key={item.id}
                      className="flex flex-col gap-3 p-4 text-body"
                    >
                      <span className="truncate font-medium">
                        {item.name || 'Unnamed item'}
                      </span>
                      {editProductLoading ? (
                        <p className="text-body text-text-muted">
                          Loading current portion options…
                        </p>
                      ) : editPortionModel && editResolution ? (
                        <>
                          <PortionSelector
                            options={editPortionModel.options}
                            selectedOptionId={editPortionOptionId}
                            customAmount={editGrams}
                            baseUnit={baseUnitForResolution(editResolution)}
                            onSelectionChange={(optionId) => {
                              setEditPortionOptionId(optionId);
                              setEditAmountDirty(true);
                              setEditError(null);
                            }}
                            onCustomAmountChange={(value) => {
                              setEditGrams(value);
                              setEditAmountDirty(true);
                            }}
                          />
                          <PortionNutritionPreview
                            nutrition={editNutritionPreview}
                          />
                        </>
                      ) : (
                        <EditAmountField
                          entry={item}
                          value={editGrams}
                          onChange={(value) => {
                            setEditGrams(value);
                            setEditAmountDirty(true);
                          }}
                        />
                      )}
                      <FieldLabel>
                        Meal
                        <Select
                          value={editMeal}
                          onChange={(e) =>
                            setEditMeal(e.target.value as MealCategory)
                          }
                        >
                          <option value="BREAKFAST">Breakfast</option>
                          <option value="LUNCH">Lunch</option>
                          <option value="DINNER">Dinner</option>
                          <option value="SNACKS">Snacks</option>
                        </Select>
                      </FieldLabel>
                      {editError && (
                        <p className="text-body text-warn">{editError}</p>
                      )}
                      <div className="flex gap-2">
                        <PrimaryButton
                          type="button"
                          onClick={() => saveEdit(item.id)}
                        >
                          Save
                        </PrimaryButton>
                        <SecondaryButton type="button" onClick={cancelEdit}>
                          Cancel
                        </SecondaryButton>
                      </div>
                    </div>
                  ) : (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-3 p-4 text-body"
                    >
                      <span className="truncate">
                        {item.name || 'Unnamed item'}
                      </span>
                      <span className="flex shrink-0 items-center gap-3 text-readout">
                        <span>
                          <HistoryAmount entry={item} />
                        </span>
                        <span>
                          {Number(item.caloriesComputed).toFixed(0)} kcal
                        </span>
                        <button
                          type="button"
                          aria-label="Edit entry"
                          onClick={() => startEdit(item)}
                          className="text-text-muted transition hover:text-accent"
                        >
                          <EditIcon width={18} height={18} />
                        </button>
                        <button
                          type="button"
                          aria-label="Delete entry"
                          onClick={() => handleDelete(item.id)}
                          className="text-text-muted transition hover:text-warn"
                        >
                          <TrashIcon width={18} height={18} />
                        </button>
                      </span>
                    </div>
                  ),
                )
              )}
            </Card>
          </div>
        ))}
      </div>
    </div>
  );
}
