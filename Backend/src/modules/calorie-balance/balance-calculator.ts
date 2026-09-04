// docs/business-logic.md §2: daily balance = consumed − expended, where
// expended = baseline TDEE only. Logged exercise burn is tracked and
// reported separately (caloriesBurnedExercise) but intentionally excluded
// from expended/balance — folding it in was confusing (an exercise entry
// would silently raise "remaining calories"), so it's informational only.
//
// dailyCalorieTarget is a distinct, goal-adjusted figure (TDEE ± offset per
// Goal direction) — kept separate from caloriesExpended/balance on purpose
// (docs/adr/0001-separate-daily-calorie-target-from-tdee.md). It drives the
// Dashboard's "remaining calories" figure only; balance and the weight-trend
// prediction keep using the unadjusted TDEE.
import { calculateDailyCalorieTarget } from '../users/goal-direction';
import type { GoalDirection } from '../users/goal-direction';

export interface DailyBalanceInput {
  caloriesConsumed: number;
  tdee: number;
  caloriesBurnedExercise?: number;
  goalDirection?: GoalDirection;
}

export interface DailyBalanceResult {
  caloriesConsumed: number;
  caloriesExpended: number;
  caloriesBurnedExercise: number;
  balance: number;
  dailyCalorieTarget: number;
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
    dailyCalorieTarget: calculateDailyCalorieTarget(
      input.tdee,
      input.goalDirection ?? 'MAINTAIN',
    ),
  };
}
