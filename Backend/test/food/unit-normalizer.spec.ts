import { BaseUnit, Prisma } from '@prisma/client';
import { normalizeMeasurement } from '../../src/modules/food/unit-normalizer';

const ALIAS_CASES: ReadonlyArray<
  readonly [string, string, number, BaseUnit, 'g' | 'ml']
> = [
  ...[
    'gram',
    'grams',
    'gramme',
    'grammes',
    'gr',
    'gm',
    'جم',
    'جرام',
    'غ',
    'غرام',
  ].map((unit) => [unit, unit, 1, BaseUnit.G, 'g'] as const),
  ...['kilogram', 'kilograms', 'kgs', 'كجم', 'كغ', 'كيلو جرام'].map(
    (unit) => [unit, unit, 1000, BaseUnit.G, 'g'] as const,
  ),
  ...['milligram', 'milligrams'].map(
    (unit) => [unit, unit, 0.001, BaseUnit.G, 'g'] as const,
  ),
  ...[
    'millilitre',
    'millilitres',
    'milliliter',
    'milliliters',
    'مل',
    'ملل',
  ].map((unit) => [unit, unit, 1, BaseUnit.ML, 'ml'] as const),
  ...['litre', 'litres', 'liter', 'liters', 'ltr', 'lt', 'لتر'].map(
    (unit) => [unit, unit, 1000, BaseUnit.ML, 'ml'] as const,
  ),
  ...['centilitre', 'centilitres', 'centiliter', 'centiliters'].map(
    (unit) => [unit, unit, 10, BaseUnit.ML, 'ml'] as const,
  ),
  ...['decilitre', 'decilitres', 'deciliter', 'deciliters'].map(
    (unit) => [unit, unit, 100, BaseUnit.ML, 'ml'] as const,
  ),
  ...['fl. oz', 'fl.oz', 'floz', 'fluid ounce', 'fluid ounces'].map(
    (unit) => [unit, unit, 29.573529563, BaseUnit.ML, 'ml'] as const,
  ),
];

describe('normalizeMeasurement', () => {
  it.each([
    [330, 'g', 330, BaseUnit.G, 'g'],
    [0.06, 'kg', 60, BaseUnit.G, 'g'],
    [60000, 'mg', 60, BaseUnit.G, 'g'],
    [330, 'ml', 330, BaseUnit.ML, 'ml'],
    [0.33, 'L', 330, BaseUnit.ML, 'ml'],
    [33, 'cl', 330, BaseUnit.ML, 'ml'],
    [3.3, 'dl', 330, BaseUnit.ML, 'ml'],
    [1.5, 'l', 1500, BaseUnit.ML, 'ml'],
    [1, 'fl oz', 29.573529563, BaseUnit.ML, 'ml'],
  ])(
    'normalizes %s %s to %s %s',
    (quantity, unit, value, baseUnit, legacyUnit) => {
      expect(normalizeMeasurement(quantity, unit)).toEqual({
        value,
        baseUnit,
        legacyUnit,
      });
    },
  );

  it.each(ALIAS_CASES)(
    'normalizes explicit alias %s',
    (_label, unit, value, baseUnit, legacyUnit) => {
      expect(normalizeMeasurement(1, unit)).toEqual({
        value,
        baseUnit,
        legacyUnit,
      });
    },
  );

  it('accepts decimal-compatible inputs and normalized token formatting', () => {
    expect(normalizeMeasurement('0.33', 'L')).toEqual({
      value: 330,
      baseUnit: BaseUnit.ML,
      legacyUnit: 'ml',
    });
    expect(normalizeMeasurement(new Prisma.Decimal('0.06'), 'kg')).toEqual({
      value: 60,
      baseUnit: BaseUnit.G,
      legacyUnit: 'g',
    });
    expect(normalizeMeasurement(250, ' ML ')).toEqual({
      value: 250,
      baseUnit: BaseUnit.ML,
      legacyUnit: 'ml',
    });
    expect(normalizeMeasurement(12, 'gr.')).toEqual({
      value: 12,
      baseUnit: BaseUnit.G,
      legacyUnit: 'g',
    });
    expect(normalizeMeasurement(1, '  كيلو   جرام  ')).toEqual({
      value: 1000,
      baseUnit: BaseUnit.G,
      legacyUnit: 'g',
    });
  });

  it.each(['oz', 'fl', 'portion', 'piece', 'bar', 'serving', '1 bar', 'stone'])(
    'treats unsupported or ambiguous unit %s as absent',
    (unit) => {
      expect(normalizeMeasurement(1, unit)).toBeNull();
    },
  );

  it.each([NaN, Infinity, -Infinity, 0, -1])(
    'treats invalid quantity %s as absent',
    (quantity) => {
      expect(normalizeMeasurement(quantity, 'g')).toBeNull();
    },
  );

  it('requires both a quantity and a unit', () => {
    expect(normalizeMeasurement(undefined, 'g')).toBeNull();
    expect(normalizeMeasurement(10, undefined)).toBeNull();
    expect(normalizeMeasurement(null, 'ml')).toBeNull();
    expect(normalizeMeasurement(10, '')).toBeNull();
  });

  it('uses decimal-safe arithmetic without binary float artifacts', () => {
    expect(normalizeMeasurement(0.33, 'L')?.value).toBe(330);
    expect(normalizeMeasurement(33, 'cl')?.value).toBe(330);
    expect(normalizeMeasurement(330, 'ml')?.value).toBe(330);
  });
});
