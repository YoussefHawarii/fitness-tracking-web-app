import { BaseUnit, Prisma } from '@prisma/client';

export interface NormalizedMeasurement {
  value: number;
  baseUnit: BaseUnit;
  legacyUnit: 'g' | 'ml';
}

interface UnitRule {
  baseUnit: BaseUnit;
  factor: string;
  legacyUnit: 'g' | 'ml';
}

const GRAM: UnitRule = {
  baseUnit: BaseUnit.G,
  factor: '1',
  legacyUnit: 'g',
};
const KILOGRAM: UnitRule = {
  baseUnit: BaseUnit.G,
  factor: '1000',
  legacyUnit: 'g',
};
const MILLIGRAM: UnitRule = {
  baseUnit: BaseUnit.G,
  factor: '0.001',
  legacyUnit: 'g',
};
const MILLILITRE: UnitRule = {
  baseUnit: BaseUnit.ML,
  factor: '1',
  legacyUnit: 'ml',
};
const LITRE: UnitRule = {
  baseUnit: BaseUnit.ML,
  factor: '1000',
  legacyUnit: 'ml',
};
const CENTILITRE: UnitRule = {
  baseUnit: BaseUnit.ML,
  factor: '10',
  legacyUnit: 'ml',
};
const DECILITRE: UnitRule = {
  baseUnit: BaseUnit.ML,
  factor: '100',
  legacyUnit: 'ml',
};
const FLUID_OUNCE: UnitRule = {
  baseUnit: BaseUnit.ML,
  factor: '29.5735295625',
  legacyUnit: 'ml',
};

const UNIT_RULES: Readonly<Record<string, UnitRule>> = {
  g: GRAM,
  gram: GRAM,
  grams: GRAM,
  gramme: GRAM,
  grammes: GRAM,
  gr: GRAM,
  gm: GRAM,
  جم: GRAM,
  جرام: GRAM,
  غ: GRAM,
  غرام: GRAM,
  kg: KILOGRAM,
  kilogram: KILOGRAM,
  kilograms: KILOGRAM,
  kgs: KILOGRAM,
  كجم: KILOGRAM,
  كغ: KILOGRAM,
  'كيلو جرام': KILOGRAM,
  mg: MILLIGRAM,
  milligram: MILLIGRAM,
  milligrams: MILLIGRAM,
  ml: MILLILITRE,
  millilitre: MILLILITRE,
  millilitres: MILLILITRE,
  milliliter: MILLILITRE,
  milliliters: MILLILITRE,
  مل: MILLILITRE,
  ملل: MILLILITRE,
  l: LITRE,
  litre: LITRE,
  litres: LITRE,
  liter: LITRE,
  liters: LITRE,
  ltr: LITRE,
  lt: LITRE,
  لتر: LITRE,
  cl: CENTILITRE,
  centilitre: CENTILITRE,
  centilitres: CENTILITRE,
  centiliter: CENTILITRE,
  centiliters: CENTILITRE,
  dl: DECILITRE,
  decilitre: DECILITRE,
  decilitres: DECILITRE,
  deciliter: DECILITRE,
  deciliters: DECILITRE,
  'fl oz': FLUID_OUNCE,
  'fl. oz': FLUID_OUNCE,
  'fl.oz': FLUID_OUNCE,
  floz: FLUID_OUNCE,
  'fluid ounce': FLUID_OUNCE,
  'fluid ounces': FLUID_OUNCE,
};

const BASE_UNIT_DECIMAL_PLACES = 9;

export function normalizeUnitToken(unit: unknown): string | null {
  if (typeof unit !== 'string') return null;
  const normalized = unit
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\.$/, '');
  return normalized || null;
}

// Decimal arithmetic avoids binary multiplication artifacts such as
// 0.33 * 1000 = 330.00000000000006. Results are rounded to nine Base-unit
// decimal places, well beyond the precision of provider and form inputs.
export function normalizeMeasurement(
  quantity: unknown,
  unit: unknown,
): NormalizedMeasurement | null {
  const unitToken = normalizeUnitToken(unit);
  if (!unitToken) return null;
  const rule = UNIT_RULES[unitToken];
  if (!rule || quantity === null || quantity === undefined) return null;
  if (
    !(quantity instanceof Prisma.Decimal) &&
    typeof quantity !== 'number' &&
    typeof quantity !== 'string'
  ) {
    return null;
  }

  let decimal: Prisma.Decimal;
  try {
    decimal =
      quantity instanceof Prisma.Decimal
        ? quantity
        : new Prisma.Decimal(quantity);
  } catch {
    return null;
  }
  if (!decimal.isFinite() || decimal.lte(0)) return null;

  const value = decimal
    .mul(rule.factor)
    .toDecimalPlaces(BASE_UNIT_DECIMAL_PLACES)
    .toNumber();
  if (!Number.isFinite(value) || value <= 0) return null;

  return { value, baseUnit: rule.baseUnit, legacyUnit: rule.legacyUnit };
}

export function legacyUnitForBaseUnit(
  baseUnit: BaseUnit | null | undefined,
): 'g' | 'ml' | null {
  if (baseUnit === BaseUnit.G) return 'g';
  if (baseUnit === BaseUnit.ML) return 'ml';
  return null;
}
