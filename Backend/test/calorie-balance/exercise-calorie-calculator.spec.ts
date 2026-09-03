import { SportType } from '@prisma/client';
import { calculateExerciseCalories } from '../../src/modules/calorie-balance/exercise-calorie-calculator';
import { MET_TABLE } from '../../src/modules/calorie-balance/exercise-met-table';

describe('calculateExerciseCalories', () => {
  it('calculates calories = MET x weight(kg) x duration(hours) for a known sport', () => {
    // Running MET 9.8, 70kg, 30 minutes (0.5h) => 9.8 * 70 * 0.5 = 343
    const result = calculateExerciseCalories(SportType.RUNNING, 70, 30);
    expect(result).toBe(343);
  });

  it('uses the general/moderate default MET for OTHER', () => {
    // OTHER MET 5.0, 80kg, 60 minutes (1h) => 5.0 * 80 * 1 = 400
    const result = calculateExerciseCalories(SportType.OTHER, 80, 60);
    expect(result).toBe(400);
  });

  it('rounds to the nearest whole calorie', () => {
    // Padel MET 6.0, 65kg, 25 minutes (0.41666h) => 6.0*65*0.41666.. = 162.5
    const result = calculateExerciseCalories(SportType.PADEL, 65, 25);
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBe(Math.round((MET_TABLE.PADEL * 65 * 25) / 60));
  });

  it('produces a plausible non-zero value for every catalog sport', () => {
    for (const sportType of Object.keys(MET_TABLE) as SportType[]) {
      const result = calculateExerciseCalories(sportType, 70, 45);
      expect(result).toBeGreaterThan(0);
    }
  });
});
