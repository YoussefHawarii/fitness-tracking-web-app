import { useCallback, useEffect, useState } from 'react';
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
  type LocalFoodItem,
  type MealCategory,
  type OpenFoodFactsProduct,
  type UsdaFoodMatch,
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

type InputMode = 'barcode' | 'voice' | 'manual';
type PendingItem =
  | { sourceType: 'OPEN_FOOD_FACTS'; sourceRef: string; name: string }
  | { sourceType: 'USDA'; sourceRef: string; name: string }
  | { sourceType: 'LOCAL'; sourceRef: string; name: string };

interface FoodLogEntry {
  id: string;
  name: string;
  grams: string;
  caloriesComputed: string;
  mealCategory: MealCategory;
  loggedAtUtc: string;
}

const MEAL_ORDER: MealCategory[] = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACKS'];

function todayLocalDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function isInputMode(value: unknown): value is InputMode {
  return value === 'barcode' || value === 'voice' || value === 'manual';
}

export function FoodLog() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const date = searchParams.get('date') || todayLocalDate();
  const requestedMode = (location.state as { mode?: unknown } | null)?.mode;
  const [mode, setMode] = useState<InputMode>(isInputMode(requestedMode) ? requestedMode : 'barcode');
  const [pendingItem, setPendingItem] = useState<PendingItem | null>(null);
  const [grams, setGrams] = useState('');
  const [mealCategory, setMealCategory] = useState<MealCategory>('BREAKFAST');
  const [status, setStatus] = useState<string | null>(null);
  const [entries, setEntries] = useState<FoodLogEntry[]>([]);

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
    const product: OpenFoodFactsProduct | null = await lookupBarcode(barcode);
    if (!product) {
      setStatus('No product found for that barcode — try manual entry.');
      setMode('manual');
      return;
    }
    setPendingItem({ sourceType: 'OPEN_FOOD_FACTS', sourceRef: barcode, name: product.name });
    setStatus(null);
  }

  function handleUsdaMatchSelected(match: UsdaFoodMatch) {
    setPendingItem({ sourceType: 'USDA', sourceRef: match.fdcId, name: match.name });
  }

  function handleLocalItemCreated(item: LocalFoodItem) {
    setPendingItem({ sourceType: 'LOCAL', sourceRef: item.id, name: item.name });
    setStatus(null);
  }

  async function handleSaveLog() {
    if (!pendingItem || !grams || Number(grams) <= 0) {
      setStatus('Choose a food item and enter a valid gram amount.');
      return;
    }
    try {
      await createFoodLog({
        sourceType: pendingItem.sourceType,
        sourceRef: pendingItem.sourceRef,
        grams: Number(grams),
        mealCategory,
        loggedAtUtc: new Date().toISOString(),
      });
      setStatus(`Logged ${pendingItem.name} under ${mealCategory}.`);
      setPendingItem(null);
      setGrams('');
      refreshEntries();
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
        onChange={setMode}
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
              <BarcodeScanner onDecoded={handleBarcodeDecoded} />
            </div>
            <p className="flex items-center gap-2 text-label text-text-muted normal-case tracking-normal">
              <ScanIcon width={16} height={16} /> Align barcode within frame
            </p>
          </div>
        )}
        {mode === 'voice' && (
          <div className="flex flex-col gap-3">
            <p className="flex items-center gap-2 text-label text-text-muted normal-case tracking-normal">
              <MicIcon width={16} height={16} /> Say what you ate
            </p>
            <VoiceLogger onMatchSelected={handleUsdaMatchSelected} />
          </div>
        )}
        {mode === 'manual' && (
          <div className="flex flex-col gap-3">
            <p className="flex items-center gap-2 text-label text-text-muted normal-case tracking-normal">
              <PlusCircleIcon width={16} height={16} /> Add a food item
            </p>
            <ManualFoodSearch
              onMatchSelected={handleUsdaMatchSelected}
              onLocalItemCreated={handleLocalItemCreated}
            />
          </div>
        )}
      </Card>

      {pendingItem && (
        <Card className="flex flex-col gap-3 p-6">
          <p className="text-heading">{pendingItem.name}</p>
          <FieldLabel>
            Grams
            <Input
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
