import type { GoalDirection } from '../services/userService';

// Mirrors Backend/src/modules/users/goal-direction.ts — Goal direction is
// derived, never stored (CONTEXT.md "Goal direction"), so the frontend
// computes it locally for instant feedback instead of round-tripping.
const MAINTAIN_TOLERANCE_KG = 0.5;

export function getGoalDirection(
  currentWeightKg: number,
  goalWeightKg: number,
): GoalDirection {
  const delta = goalWeightKg - currentWeightKg;
  if (Math.abs(delta) <= MAINTAIN_TOLERANCE_KG) {
    return 'MAINTAIN';
  }
  return delta < 0 ? 'LOSE' : 'GAIN';
}

export const GOAL_DIRECTION_LABEL: Record<GoalDirection, string> = {
  LOSE: 'Lose weight',
  MAINTAIN: 'Maintain weight',
  GAIN: 'Gain weight',
};
