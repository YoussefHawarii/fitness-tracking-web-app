import type { BaseUnit } from '../../services/foodService';
import {
  baseUnitForResolution,
  type LoggableBarcodeResolution,
  type PortionChoice,
} from './portionOptions';

export type PortionCreatePayload =
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
      portionMultiplier?: never;
    };

export interface PortionNutritionPer100 {
  caloriesPer100g: number;
  proteinPer100g?: number | null;
  carbsPer100g?: number | null;
  fatPer100g?: number | null;
}

export interface PortionNutrition {
  calories: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}

export function isValidPortionAmountInput(value: string): boolean {
  const amount = Number(value);
  return (
    value.length > 0 &&
    Number.isFinite(amount) &&
    amount > 0 &&
    /^\d+(?:\.\d)?$/.test(value)
  );
}

export function buildPortionCreatePayload(
  resolution: LoggableBarcodeResolution,
  choice: PortionChoice | null,
  customAmount: string,
): PortionCreatePayload | null {
  if (!choice) return null;

  const amountUnit = baseUnitForResolution(resolution);
  if (choice.portionKind === 'CUSTOM') {
    if (!isValidPortionAmountInput(customAmount)) return null;
    return {
      amount: Number(customAmount),
      amountUnit,
      portionKind: 'CUSTOM',
    };
  }

  return {
    amount: choice.amount,
    amountUnit,
    portionKind: choice.portionKind,
    portionMultiplier: choice.portionMultiplier,
  };
}

export function calculatePortionNutrition(
  nutrients: PortionNutritionPer100,
  amount: number,
): PortionNutrition {
  const scale = amount / 100;
  return {
    calories: nutrients.caloriesPer100g * scale,
    protein:
      nutrients.proteinPer100g == null
        ? null
        : nutrients.proteinPer100g * scale,
    carbs:
      nutrients.carbsPer100g == null ? null : nutrients.carbsPer100g * scale,
    fat: nutrients.fatPer100g == null ? null : nutrients.fatPer100g * scale,
  };
}
