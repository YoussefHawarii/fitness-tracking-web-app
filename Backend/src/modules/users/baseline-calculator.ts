export type Sex = 'MALE' | 'FEMALE';
export type ActivityLevel =
  'LIGHTLY_ACTIVE' | 'MODERATELY_ACTIVE' | 'VERY_ACTIVE';

export interface BaselineInput {
  sex: Sex;
  weightKg: number;
  heightCm: number;
  age: number;
  activityLevel: ActivityLevel;
}

export interface BaselineResult {
  bmr: number;
  tdee: number;
}

// Non-exercise activity multipliers only (docs/business-logic.md §1). Exercise
// burn is logged separately (calorie-balance module) — using a
// higher, exercise-inclusive multiplier here would double-count it. The
// labels shown to the user ("Lightly/Moderately/Very active") are a loose,
// familiar proxy for everyday activity, not a literal exercise-frequency
// input — the top tier deliberately stays a modest step (1.55) rather than
// the 1.725/1.9 a true exercise-inclusive scale would use.
const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  LIGHTLY_ACTIVE: 1.2,
  MODERATELY_ACTIVE: 1.375,
  VERY_ACTIVE: 1.55,
};

// Mifflin-St Jeor equation.
export function calculateBmr({
  sex,
  weightKg,
  heightCm,
  age,
}: BaselineInput): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'MALE' ? base + 5 : base - 161;
}

export function calculateBaseline(input: BaselineInput): BaselineResult {
  const bmr = calculateBmr(input);
  const tdee = bmr * ACTIVITY_MULTIPLIERS[input.activityLevel];
  return { bmr, tdee };
}
