import { calculateDailyBalance } from '../../src/modules/calorie-balance/balance-calculator';

describe('balance-calculator', () => {
  it('defaults exercise burn to zero when not provided', () => {
    const result = calculateDailyBalance({
      caloriesConsumed: 2000,
      tdee: 1800,
    });
    expect(result.caloriesExpended).toBe(1800);
    expect(result.balance).toBe(200);
  });

  it('reports logged exercise burn separately without folding it into expended/balance', () => {
    const result = calculateDailyBalance({
      caloriesConsumed: 2000,
      tdee: 1800,
      caloriesBurnedExercise: 300,
    });
    expect(result.caloriesExpended).toBe(1800);
    expect(result.caloriesBurnedExercise).toBe(300);
    expect(result.balance).toBe(200);
  });

  it('reports a negative balance as a deficit (weight-loss direction)', () => {
    const result = calculateDailyBalance({
      caloriesConsumed: 1500,
      tdee: 2000,
    });
    expect(result.balance).toBeLessThan(0);
  });

  it('reports a positive balance as a surplus (weight-gain direction)', () => {
    const result = calculateDailyBalance({
      caloriesConsumed: 2500,
      tdee: 2000,
    });
    expect(result.balance).toBeGreaterThan(0);
  });
});
