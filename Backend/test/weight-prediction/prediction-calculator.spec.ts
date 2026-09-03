import {
  calculatePredictedWeight,
  calculatePredictedWeightChangeKg,
} from '../../src/modules/weight-prediction/prediction-calculator';

describe('prediction-calculator', () => {
  it('converts cumulative balance to a weight change using the 7700 kcal/kg rule', () => {
    expect(calculatePredictedWeightChangeKg(-7700)).toBeCloseTo(-1);
    expect(calculatePredictedWeightChangeKg(7700)).toBeCloseTo(1);
    expect(calculatePredictedWeightChangeKg(0)).toBe(0);
  });

  it('applies the predicted change to the starting weight', () => {
    expect(calculatePredictedWeight(80, -3850)).toBeCloseTo(79.5);
  });

  it('predicts weight loss direction for a sustained deficit', () => {
    const predicted = calculatePredictedWeight(80, -7 * 500); // 500 kcal/day deficit over a week
    expect(predicted).toBeLessThan(80);
  });

  it('predicts weight gain direction for a sustained surplus', () => {
    const predicted = calculatePredictedWeight(80, 7 * 500);
    expect(predicted).toBeGreaterThan(80);
  });
});
