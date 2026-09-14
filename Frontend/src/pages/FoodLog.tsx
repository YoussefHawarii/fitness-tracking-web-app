import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { isAxiosError } from 'axios';
import { BarcodeScanner } from '../features/barcode-scanner/BarcodeScanner';
import { VoiceLogger } from '../features/voice-logger/VoiceLogger';
import { ManualFoodSearch } from '../features/manual-food-search/ManualFoodSearch';
import {
  createFoodLog,
  deleteFoodLog,
  listFoodLogsForDay,
  lookupBarcode,
  updateFoodLog,
  type FoodMatch,
  type FoodSourceType,
  type LocalFoodItem,
  type MealCategory,
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
type PendingItem = {
  sourceType: FoodSourceType;
  sourceRef: string;
  name: string;
  caloriesPer100g: number;
};

type ScanStatus = 'idle' | 'looking-up' | 'found' | 'not-found' | 'unavailable';

interface FoodLogEntry {
  id: string;
  name: string;
  grams: string;
  caloriesComputed: string;
  mealCategory: MealCategory;
  loggedAtUtc: string;
}

const MEAL_ORDER: MealCategory[] = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACKS'];

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

export function FoodLog() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { todayInAccountTimezone } = useAccountTimezone();
  const date = searchParams.get('date') || todayInAccountTimezone();
  const requestedMode = (location.state as { mode?: unknown } | null)?.mode;
  const [mode, setMode] = useState<InputMode>(isInputMode(requestedMode) ? requestedMode : 'barcode');

  // A queue rather than a single item so a voice recording that splits into
  // several food terms ("chicken and rice") can be logged one at a time
  // without losing the rest — see docs/food-log-input-modes-diagnosis.md §2.3.
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const pendingItem = pendingItems[0] ?? null;
  const pendingCardRef = useRef<HTMLDivElement>(null);
  const gramsInputRef = useRef<HTMLInputElement>(null);

  const [grams, setGrams] = useState('');
  const [mealCategory, setMealCategory] = useState<MealCategory>('BREAKFAST');
  const [status, setStatus] = useState<string | null>(null);
  const [entries, setEntries] = useState<FoodLogEntry[]>([]);

  // Barcode scan state machine — see docs/food-log-input-modes-diagnosis.md
  // §1.4/§1.6: a successful scan needs its own visible "found"/"not found"
  // states inside the scan card itself, not just a muted caption below it.
  const [scanStatus, setScanStatus] = useState<ScanStatus>('idle');
  const [lastScannedBarcode, setLastScannedBarcode] = useState<string | null>(null);
  const [scanAttempt, setScanAttempt] = useState(0);
  // Bumped on every new scan attempt (and whenever the user leaves the scan
  // in progress) so a lookup abandoned by a rescan/mode-switch can't apply
  // its result after something newer has already taken its place.
  const scanRequestIdRef = useRef(0);
  const [manualPrefill, setManualPrefill] = useState<string | undefined>(undefined);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editGrams, setEditGrams] = useState('');
  const [editMeal, setEditMeal] = useState<MealCategory>('BREAKFAST');
  const [editError, setEditError] = useState<string | null>(null);

  const refreshEntries = useCallback(() => {
    listFoodLogsForDay(date)
      .then(setEntries)
      .catch(() => undefined);
  }, [date]);

  useEffect(() => {
    refreshEntries();
  }, [refreshEntries]);

  useEffect(() => {
    if (pendingItems.length > 0) {
      pendingCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      // Selecting an item (scan/voice/manual) means grams is the very next
      // thing to fill in — see docs/food-log-input-modes-diagnosis.md §1.6
      // item 5.
      gramsInputRef.current?.focus();
    }
  }, [pendingItems.length]);

  function startEdit(entry: FoodLogEntry) {
    setEditingId(entry.id);
    setEditGrams(entry.grams);
    setEditMeal(entry.mealCategory);
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function saveEdit(id: string) {
    const gramsValue = Number(editGrams);
    if (!editGrams || !Number.isFinite(gramsValue) || gramsValue <= 0) {
      setEditError('Enter a valid gram amount greater than 0.');
      return;
    }
    try {
      await updateFoodLog(id, { grams: gramsValue, mealCategory: editMeal });
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
      setEditError('Could not save this change.');
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
      setPendingItems([
        {
          sourceType: 'OPEN_FOOD_FACTS',
          sourceRef: barcode,
          name: product.name,
          caloriesPer100g: product.caloriesPer100g,
        },
      ]);
      setScanStatus('found');
      setStatus(null);
    } catch {
      // lookupBarcode only throws BarcodeLookupUnavailableError (a genuine
      // "not found" resolves to null instead, handled above) — any failure
      // here means the lookup itself couldn't be completed.
      if (scanRequestIdRef.current !== requestId) return;
      setScanStatus('unavailable');
    }
  }

  function retryLastScan() {
    if (lastScannedBarcode) {
      handleBarcodeDecoded(lastScannedBarcode);
    }
  }

  function rescan() {
    scanRequestIdRef.current++; // invalidate any lookup still in flight
    setScanStatus('idle');
    setLastScannedBarcode(null);
    setScanAttempt((n) => n + 1);
  }

  // Re-entering the Scan tab should always show a fresh camera view, not a
  // leftover "not found"/"unavailable" banner from a previous visit.
  function handleModeChange(newMode: InputMode) {
    if (newMode === 'barcode' && mode !== 'barcode') {
      rescan();
    }
    if (mode === 'barcode' && newMode !== 'barcode' && scanStatus === 'looking-up') {
      scanRequestIdRef.current++; // leaving mid-lookup invalidates it too
    }
    if (newMode !== 'manual') {
      setManualPrefill(undefined); // don't carry a stale barcode into an unrelated later Manual visit
    }
    setMode(newMode);
  }

  function handleFoodMatchSelected(match: FoodMatch) {
    setPendingItems([toPendingItem(match)]);
    setStatus(null);
  }

  function handleFoodMatchesSelected(matches: FoodMatch[]) {
    if (matches.length === 0) return;
    setPendingItems(matches.map(toPendingItem));
    setStatus(null);
  }

  function handleLocalItemCreated(item: LocalFoodItem) {
    setPendingItems([
      { sourceType: 'LOCAL', sourceRef: item.id, name: item.name, caloriesPer100g: item.caloriesPer100g },
    ]);
    setStatus(null);
  }

  async function handleSaveLog() {
    const current = pendingItems[0];
    if (!current || !grams || Number(grams) <= 0) {
      setStatus('Choose a food item and enter a valid gram amount.');
      return;
    }
    try {
      await createFoodLog({
        sourceType: current.sourceType,
        sourceRef: current.sourceRef,
        name: current.sourceType === 'CANONICAL' ? current.name : undefined,
        grams: Number(grams),
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
      setPendingItems((prev) => prev.slice(1));
      setGrams('');
      refreshEntries();
      // A scanned item was just saved and nothing else is queued — return
      // the scan card to a ready-to-scan-again state instead of leaving the
      // stale "✓ Found" caption's camera box sitting there blank.
      if (current.sourceType === 'OPEN_FOOD_FACTS' && !stillQueued) {
        rescan();
      }
    } catch {
      setStatus('Could not save this entry.');
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
              {scanStatus !== 'not-found' && scanStatus !== 'unavailable' && (
                <BarcodeScanner
                  key={scanAttempt}
                  onDecoded={handleBarcodeDecoded}
                  onScanError={() => setScanStatus('unavailable')}
                />
              )}
              {(scanStatus === 'not-found' || scanStatus === 'unavailable') && (
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
                <ScanIcon width={16} height={16} /> Barcode detected — looking it up…
              </p>
            )}
            {scanStatus === 'found' && pendingItem?.sourceType === 'OPEN_FOOD_FACTS' && (
              <p className="flex items-center gap-2 text-label text-accent normal-case tracking-normal">
                ✓ Found: {pendingItem.name}
              </p>
            )}
            {scanStatus === 'not-found' && (
              <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
                <p className="text-body">We couldn't find a product for that barcode.</p>
                <div className="flex flex-wrap gap-2">
                  <PrimaryButton
                    type="button"
                    onClick={() => {
                      setManualPrefill(lastScannedBarcode ?? undefined);
                      setMode('manual');
                    }}
                  >
                    Search manually instead
                  </PrimaryButton>
                  <SecondaryButton type="button" onClick={rescan}>
                    Scan again
                  </SecondaryButton>
                </div>
              </div>
            )}
            {scanStatus === 'unavailable' && (
              <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
                <p className="text-body text-warn">
                  Couldn't check that barcode right now — try again in a moment.
                </p>
                <div className="flex flex-wrap gap-2">
                  {/* No barcode yet (a scanner/camera error via onScanError) means retrying the lookup is a no-op — restart the scanner instead. */}
                  <PrimaryButton type="button" onClick={lastScannedBarcode ? retryLastScan : rescan}>
                    Try again
                  </PrimaryButton>
                  <SecondaryButton type="button" onClick={() => setMode('manual')}>
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
            <ManualFoodSearch
              onMatchSelected={handleFoodMatchSelected}
              onLocalItemCreated={handleLocalItemCreated}
              initialQuery={manualPrefill}
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
            <p className="text-body text-text-muted">{pendingItem.caloriesPer100g} kcal/100g</p>
            <FieldLabel>
              Grams
              <Input
                ref={gramsInputRef}
                type="number"
                min={1}
                value={grams}
                onChange={(e) => setGrams(e.target.value)}
              />
            </FieldLabel>
            <FieldLabel>
              Meal
              <Select value={mealCategory} onChange={(e) => setMealCategory(e.target.value as MealCategory)}>
                <option value="BREAKFAST">Breakfast</option>
                <option value="LUNCH">Lunch</option>
                <option value="DINNER">Dinner</option>
                <option value="SNACKS">Snacks</option>
              </Select>
            </FieldLabel>
            <PrimaryButton onClick={handleSaveLog} className="self-start">
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
              {items.length > 0 && <span className="text-readout text-xs text-text-muted">{total.toFixed(0)} KCAL</span>}
            </div>
            <Card className="divide-y divide-border">
              {items.length === 0 ? (
                <p className="p-4 text-body text-text-muted">No items logged.</p>
              ) : (
                items.map((item) =>
                  editingId === item.id ? (
                    <div key={item.id} className="flex flex-col gap-3 p-4 text-body">
                      <span className="truncate font-medium">{item.name || 'Unnamed item'}</span>
                      <FieldLabel>
                        Grams
                        <Input
                          type="number"
                          min={1}
                          value={editGrams}
                          onChange={(e) => setEditGrams(e.target.value)}
                        />
                      </FieldLabel>
                      <FieldLabel>
                        Meal
                        <Select
                          value={editMeal}
                          onChange={(e) => setEditMeal(e.target.value as MealCategory)}
                        >
                          <option value="BREAKFAST">Breakfast</option>
                          <option value="LUNCH">Lunch</option>
                          <option value="DINNER">Dinner</option>
                          <option value="SNACKS">Snacks</option>
                        </Select>
                      </FieldLabel>
                      {editError && <p className="text-body text-warn">{editError}</p>}
                      <div className="flex gap-2">
                        <PrimaryButton type="button" onClick={() => saveEdit(item.id)}>
                          Save
                        </PrimaryButton>
                        <SecondaryButton type="button" onClick={cancelEdit}>
                          Cancel
                        </SecondaryButton>
                      </div>
                    </div>
                  ) : (
                    <div key={item.id} className="flex items-center justify-between gap-3 p-4 text-body">
                      <span className="truncate">{item.name || 'Unnamed item'}</span>
                      <span className="flex shrink-0 items-center gap-3 text-readout">
                        <span>{Number(item.grams).toFixed(0)} g</span>
                        <span>{Number(item.caloriesComputed).toFixed(0)} kcal</span>
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
