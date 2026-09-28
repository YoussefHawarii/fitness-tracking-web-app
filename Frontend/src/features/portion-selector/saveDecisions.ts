import type {
  BaseUnit,
  FoodSourceType,
  MealCategory,
  PortionKind,
} from '../../services/foodService';
import { assessPlausibility } from './plausibility';
import {
  baseUnitForResolution,
  type LoggableBarcodeResolution,
} from './portionOptions';

type Confirm = (message: string) => boolean;
type Save<TPayload, TValue> = (payload: TPayload) => Promise<TValue> | TValue;

export interface CreateSubmittedPayload {
  sourceType: FoodSourceType;
  sourceRef: string;
  name?: string;
  amount: number;
  amountUnit: BaseUnit;
  portionKind?: PortionKind;
  portionMultiplier?: number;
  mealCategory: MealCategory;
  loggedAtUtc: string;
}

export type EditSubmittedPayload =
  | { mealCategory: MealCategory }
  | {
      amount: number;
      amountUnit: BaseUnit;
      portionKind?: PortionKind;
      portionMultiplier?: number;
      mealCategory: MealCategory;
    };

export interface StoredEntryForEdit {
  caloriesComputed: string | number;
  grams?: string | number | null;
  amount?: string | number | null;
  amountUnit?: BaseUnit | null;
}

export type SaveOutcome<TPayload, TValue> =
  { saved: false } | { saved: true; payload: TPayload; value: TValue };

interface SaveCreateInput<TValue> {
  pendingItem: { caloriesPer100g: number };
  submittedPayload: CreateSubmittedPayload;
  resolution: LoggableBarcodeResolution | null;
  dailyCalorieTarget: number | null;
  confirm: Confirm;
  save: Save<CreateSubmittedPayload, TValue>;
}

interface SaveEditInput<TValue> {
  entry: StoredEntryForEdit;
  product: { caloriesPer100g: number } | null;
  submittedPayload: EditSubmittedPayload;
  resolution: LoggableBarcodeResolution | null;
  dailyCalorieTarget: number | null;
  confirm: Confirm;
  save: Save<EditSubmittedPayload, TValue>;
}

async function savePayload<TPayload, TValue>(
  payload: TPayload,
  save: Save<TPayload, TValue>,
): Promise<SaveOutcome<TPayload, TValue>> {
  const value = await save(payload);
  return { saved: true, payload, value };
}

export async function saveCreateWithPlausibility<TValue>({
  pendingItem,
  submittedPayload,
  resolution,
  dailyCalorieTarget,
  confirm,
  save,
}: SaveCreateInput<TValue>): Promise<
  SaveOutcome<CreateSubmittedPayload, TValue>
> {
  const entryCalories =
    (pendingItem.caloriesPer100g * submittedPayload.amount) / 100;
  const advisory = assessPlausibility({
    amount: submittedPayload.amount,
    amountUnit: submittedPayload.amountUnit,
    resolution,
    entryCalories,
    dailyCalorieTarget,
  });
  if (advisory.advise && !confirm(advisory.message)) {
    return { saved: false };
  }
  return savePayload(submittedPayload, save);
}

export async function saveEditWithPlausibility<TValue>({
  entry,
  product,
  submittedPayload,
  resolution,
  dailyCalorieTarget,
  confirm,
  save,
}: SaveEditInput<TValue>): Promise<SaveOutcome<EditSubmittedPayload, TValue>> {
  if (!('amount' in submittedPayload)) {
    return savePayload(submittedPayload, save);
  }

  const storedAmount = Number(entry.amount ?? entry.grams);
  const storedCalories = Number(entry.caloriesComputed);
  const storedUnit = entry.amountUnit ?? 'G';
  const canUseCurrentProduct =
    product !== null &&
    resolution !== null &&
    baseUnitForResolution(resolution) === storedUnit &&
    baseUnitForResolution(resolution) === submittedPayload.amountUnit;
  const entryCalories = canUseCurrentProduct
    ? (product.caloriesPer100g * submittedPayload.amount) / 100
    : (storedCalories * submittedPayload.amount) / storedAmount;
  const advisory = assessPlausibility({
    amount: submittedPayload.amount,
    amountUnit: submittedPayload.amountUnit,
    resolution,
    entryCalories,
    dailyCalorieTarget,
  });
  if (advisory.advise && !confirm(advisory.message)) {
    return { saved: false };
  }
  return savePayload(submittedPayload, save);
}
