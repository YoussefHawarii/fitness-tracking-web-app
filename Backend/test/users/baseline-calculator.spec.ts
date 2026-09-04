import {
  calculateBaseline,
  calculateBmr,
} from '../../src/modules/users/baseline-calculator';

describe('baseline-calculator', () => {
  describe('calculateBmr', () => {
    it('computes BMR for men as 10w + 6.25h - 5a + 5', () => {
      const bmr = calculateBmr({
        sex: 'MALE',
        weightKg: 80,
        heightCm: 180,
        age: 30,
        activityLevel: 'LIGHTLY_ACTIVE',
      });
      // 10*80 + 6.25*180 - 5*30 + 5 = 800 + 1125 - 150 + 5 = 1780
      expect(bmr).toBeCloseTo(1780);
    });

    it('computes BMR for women as 10w + 6.25h - 5a - 161', () => {
      const bmr = calculateBmr({
        sex: 'FEMALE',
        weightKg: 65,
        heightCm: 165,
        age: 28,
        activityLevel: 'LIGHTLY_ACTIVE',
      });
      // 10*65 + 6.25*165 - 5*28 - 161 = 650 + 1031.25 - 140 - 161 = 1380.25
      expect(bmr).toBeCloseTo(1380.25);
    });
  });

  describe('calculateBaseline', () => {
    it('applies the Lightly active multiplier (1.2)', () => {
      const { bmr, tdee } = calculateBaseline({
        sex: 'MALE',
        weightKg: 80,
        heightCm: 180,
        age: 30,
        activityLevel: 'LIGHTLY_ACTIVE',
      });
      expect(tdee).toBeCloseTo(bmr * 1.2);
    });

    it('applies the Moderately active multiplier (1.375)', () => {
      const { bmr, tdee } = calculateBaseline({
        sex: 'FEMALE',
        weightKg: 65,
        heightCm: 165,
        age: 28,
        activityLevel: 'MODERATELY_ACTIVE',
      });
      expect(tdee).toBeCloseTo(bmr * 1.375);
    });

    it('applies the Very active multiplier (1.55), a modest step rather than an exercise-inclusive one', () => {
      const { bmr, tdee } = calculateBaseline({
        sex: 'MALE',
        weightKg: 80,
        heightCm: 180,
        age: 30,
        activityLevel: 'VERY_ACTIVE',
      });
      expect(tdee).toBeCloseTo(bmr * 1.55);
      expect(tdee / bmr).toBeLessThanOrEqual(1.55);
    });
  });
});
