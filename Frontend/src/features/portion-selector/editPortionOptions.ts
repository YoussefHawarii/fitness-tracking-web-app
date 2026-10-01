import type { BaseUnit, PortionKind } from '../../services/foodService';
import {
  buildPortionOptions,
  type LoggableBarcodeResolution,
  type PortionOptionsResult,
} from './portionOptions';

export interface StoredFoodLogPortion {
  amount: string;
  amountUnit: BaseUnit;
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
    amount: Number(entry.amount),
    amountUnit: entry.amountUnit,
  });
}
