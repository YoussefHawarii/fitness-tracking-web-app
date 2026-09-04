// Goal direction is derived, never stored (CONTEXT.md "Goal direction") — computed
// wherever needed from Goal weight vs current weight, not a database column.
export type GoalDirection = 'LOSE' | 'MAINTAIN' | 'GAIN';

const MAINTAIN_TOLERANCE_KG = 0.5;

export function calculateGoalDirection(
  currentWeightKg: number,
  goalWeightKg: number,
): GoalDirection {
  const delta = goalWeightKg - currentWeightKg;
  if (Math.abs(delta) <= MAINTAIN_TOLERANCE_KG) {
    return 'MAINTAIN';
  }
  return delta < 0 ? 'LOSE' : 'GAIN';
}

// Daily calorie target is a separate, goal-adjusted figure — kept apart from
// TDEE on purpose (docs/adr/0001-separate-daily-calorie-target-from-tdee.md).
// TDEE itself must stay unadjusted: it drives the daily balance and the
// weight-trend prediction, which need to reflect real physiology, not the
// user's aspiration.
const CALORIE_OFFSET_KCAL = 500;

export function calculateDailyCalorieTarget(
  tdee: number,
  goalDirection: GoalDirection,
): number {
  if (goalDirection === 'LOSE') {
    return tdee - CALORIE_OFFSET_KCAL;
  }
  if (goalDirection === 'GAIN') {
    return tdee + CALORIE_OFFSET_KCAL;
  }
  return tdee;
}
