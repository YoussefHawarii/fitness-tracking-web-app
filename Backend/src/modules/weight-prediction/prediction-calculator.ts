// docs/business-logic.md §3: predicted weight change (kg) = cumulative
// balance ÷ 7700 (kcal per kg), applied to the user's weight at the start of
// the window. Always a directional estimate, never a precise figure.

const KCAL_PER_KG = 7700;

export function calculatePredictedWeightChangeKg(
  cumulativeBalance: number,
): number {
  return cumulativeBalance / KCAL_PER_KG;
}

export function calculatePredictedWeight(
  startWeightKg: number,
  cumulativeBalance: number,
): number {
  return startWeightKg + calculatePredictedWeightChangeKg(cumulativeBalance);
}

export interface PredictedVsActual {
  predictedWeightKg: number;
  actualWeightKg: number;
  deltaKg: number; // actual − predicted; positive = heavier than predicted
}

export function calculatePredictedVsActual(
  predictedWeightKg: number,
  actualWeightKg: number,
): PredictedVsActual {
  return {
    predictedWeightKg,
    actualWeightKg,
    deltaKg: actualWeightKg - predictedWeightKg,
  };
}
