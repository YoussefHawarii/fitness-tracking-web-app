export type Sex = 'MALE' | 'FEMALE';
export type ActivityLevel = 'SEDENTARY' | 'LIGHT';

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
// higher, exercise-inclusive multiplier here would double-count it.
const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  SEDENTARY: 1.2,
  LIGHT: 1.375,
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
