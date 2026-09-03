// docs/business-logic.md §2: daily balance = consumed − expended, where
// expended = baseline TDEE only. Logged exercise burn is tracked and
// reported separately (caloriesBurnedExercise) but intentionally excluded
// from expended/balance — folding it in was confusing (an exercise entry
// would silently raise "remaining calories"), so it's informational only.

export interface DailyBalanceInput {
  caloriesConsumed: number;
  tdee: number;
  caloriesBurnedExercise?: number;
}

export interface DailyBalanceResult {
  caloriesConsumed: number;
  caloriesExpended: number;
  caloriesBurnedExercise: number;
  balance: number;
}

export function calculateDailyBalance(
  input: DailyBalanceInput,
): DailyBalanceResult {
  const caloriesExpended = input.tdee;
  return {
    caloriesConsumed: input.caloriesConsumed,
    caloriesExpended,
    caloriesBurnedExercise: input.caloriesBurnedExercise ?? 0,
    balance: input.caloriesConsumed - caloriesExpended,
  };
}
