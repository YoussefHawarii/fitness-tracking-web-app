import type { BaseUnit } from '../../services/foodService';
import {
  formatPortionAmount,
  type LoggableBarcodeResolution,
} from './portionOptions';

export interface PlausibilityInput {
  amount: number;
  amountUnit: BaseUnit;
  resolution: LoggableBarcodeResolution | null;
  entryCalories: number;
  dailyCalorieTarget: number | null;
}

export type PlausibilityResult =
  { advise: false } | { advise: true; message: string };

function formatCalories(value: number): string {
  return value.toLocaleString('en-US', {
    useGrouping: false,
    maximumFractionDigits: 1,
  });
}

function calorieContext(
  entryCalories: number,
  dailyCalorieTarget: number | null,
): string | null {
  if (
    dailyCalorieTarget === null ||
    !Number.isFinite(dailyCalorieTarget) ||
    dailyCalorieTarget <= 0 ||
    !Number.isFinite(entryCalories) ||
    entryCalories <= dailyCalorieTarget
  ) {
    return null;
  }

  return `It contains ${formatCalories(entryCalories)} kcal, above your ${formatCalories(dailyCalorieTarget)} kcal daily target.`;
}

export function assessPlausibility({
  amount,
  amountUnit,
  resolution,
  entryCalories,
  dailyCalorieTarget,
}: PlausibilityInput): PlausibilityResult {
  if (!Number.isFinite(amount) || amount <= 0) return { advise: false };

  const packageMeasurement = resolution?.package;
  const hasUsablePackage =
    packageMeasurement !== null &&
    packageMeasurement !== undefined &&
    packageMeasurement.baseUnit === amountUnit &&
    Number.isFinite(packageMeasurement.size) &&
    packageMeasurement.size > 0;

  if (hasUsablePackage) {
    if (amount <= 3 * packageMeasurement.size) return { advise: false };

    const calories = calorieContext(entryCalories, dailyCalorieTarget);
    const packageComparison =
      `This amount is more than 3 times the package size ` +
      `(${formatPortionAmount(amount, amountUnit)} vs ` +
      `${formatPortionAmount(packageMeasurement.size, amountUnit)} per package).`;
    return {
      advise: true,
      message: `${packageComparison}${calories ? ` ${calories}` : ''} Save it anyway?`,
    };
  }

  const calories = calorieContext(entryCalories, dailyCalorieTarget);
  if (!calories) return { advise: false };
  return { advise: true, message: `${calories} Save it anyway?` };
}
