import type { BaseUnit, PortionKind } from '../../services/foodService';
import {
  buildPortionOptions,
  type LoggableBarcodeResolution,
  type PortionOptionsResult,
} from './portionOptions';

export interface StoredFoodLogPortion {
  grams: string | null;
  amount?: string | null;
  amountUnit?: BaseUnit | null;
  portionKind?: PortionKind | null;
  portionMultiplier?: string | null;
}

export function buildEditPortionOptions(
  entry: StoredFoodLogPortion,
  resolution: LoggableBarcodeResolution,
): PortionOptionsResult {
  return buildPortionOptions(resolution, {
    portionKind: entry.portionKind ?? null,
    portionMultiplier:
      entry.portionMultiplier == null ? null : Number(entry.portionMultiplier),
    amount: Number(entry.amount ?? entry.grams),
    amountUnit: entry.amountUnit ?? 'G',
  });
}
