import { calculatePredictedVsActual } from '../../src/modules/weight-prediction/prediction-calculator';

describe('comparison-calculator (predicted vs actual)', () => {
  it('computes a positive delta when the actual weigh-in is heavier than predicted', () => {
    const result = calculatePredictedVsActual(79, 80);
    expect(result.deltaKg).toBeCloseTo(1);
  });

  it('computes a negative delta when the actual weigh-in is lighter than predicted', () => {
    const result = calculatePredictedVsActual(80, 78.5);
    expect(result.deltaKg).toBeCloseTo(-1.5);
  });

  it('computes a zero delta when the prediction matched exactly', () => {
    const result = calculatePredictedVsActual(80, 80);
    expect(result.deltaKg).toBe(0);
  });
});
