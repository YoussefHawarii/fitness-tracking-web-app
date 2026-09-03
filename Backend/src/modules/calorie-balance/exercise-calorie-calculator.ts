import { SportType } from '@prisma/client';
import { MET_TABLE } from './exercise-met-table';

// calories = MET × weight(kg) × duration(hours) — standard MET-based
// estimation. See specs/004-exercise-tracking-page/research.md.
export function calculateExerciseCalories(
  sportType: SportType,
  weightKg: number,
  durationMinutes: number,
): number {
  const met = MET_TABLE[sportType];
  const durationHours = durationMinutes / 60;
  return Math.round(met * weightKg * durationHours);
}
