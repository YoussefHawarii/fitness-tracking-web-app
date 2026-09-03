import { calculateNutrientsForGrams } from '../../src/modules/food/calorie-calculator';

describe('calorie-calculator', () => {
  it('scales calories per 100g to the entered gram amount', () => {
    const result = calculateNutrientsForGrams({ caloriesPer100g: 250 }, 150);
    // (250 / 100) * 150 = 375
    expect(result.calories).toBeCloseTo(375);
  });

  it('scales macros using the same formula as calories', () => {
    const result = calculateNutrientsForGrams(
      {
        caloriesPer100g: 200,
        proteinPer100g: 20,
        carbsPer100g: 30,
        fatPer100g: 5,
      },
      50,
    );
    expect(result.calories).toBeCloseTo(100);
    expect(result.protein).toBeCloseTo(10);
    expect(result.carbs).toBeCloseTo(15);
    expect(result.fat).toBeCloseTo(2.5);
  });

  it('returns null for macros that were not provided, rather than 0', () => {
    const result = calculateNutrientsForGrams({ caloriesPer100g: 100 }, 100);
    expect(result.protein).toBeNull();
    expect(result.carbs).toBeNull();
    expect(result.fat).toBeNull();
  });

  it('returns zero calories for a zero-calorie item, not null', () => {
    const result = calculateNutrientsForGrams({ caloriesPer100g: 0 }, 100);
    expect(result.calories).toBe(0);
  });
});
