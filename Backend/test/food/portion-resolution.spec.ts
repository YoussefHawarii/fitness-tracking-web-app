import * as fs from 'fs';
import * as path from 'path';
import {
  BaseUnit,
  ContainerKey,
  NutritionBasis,
  Prisma,
  ProductSource,
  VerificationStatus,
  type PackagedProduct,
} from '@prisma/client';
import { mapOffPackagingShapes } from '../../src/modules/food/container-key';
import { resolvePackagedProductPortion } from '../../src/modules/food/portion-resolution';
import { normalizeMeasurement } from '../../src/modules/food/unit-normalizer';

interface OffFixtureProduct {
  product_name?: string;
  brands?: string;
  image_front_url?: string;
  product_quantity?: number;
  product_quantity_unit?: string;
  serving_quantity?: number;
  serving_quantity_unit?: string;
  nutrition_data_per?: string;
  packagings?: Array<{ shape?: string }>;
}

interface OffFixture {
  code: string;
  product: OffFixtureProduct;
}

function productRow(overrides: Partial<PackagedProduct> = {}): PackagedProduct {
  return {
    id: 'product-1',
    barcode: '5449000000996',
    name: 'Fixture product',
    nameAr: null,
    brand: null,
    category: null,
    servingSize: null,
    servingBaseUnit: null,
    packageSize: null,
    packageBaseUnit: null,
    containerKey: null,
    declaredNutritionBasis: null,
    caloriesPer100g: new Prisma.Decimal(42),
    proteinPer100g: null,
    carbsPer100g: null,
    fatPer100g: null,
    fiberPer100g: null,
    sugarPer100g: null,
    sodiumPer100g: null,
    imageUrl: null,
    country: null,
    source: ProductSource.OPEN_FOOD_FACTS,
    sourceId: '5449000000996',
    verificationStatus: VerificationStatus.EXTERNAL,
    lastProviderCheckAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function recordedOffProduct(name: string): {
  fixture: OffFixture;
  row: PackagedProduct;
} {
  const fixture = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, 'fixtures', 'off', `${name}.json`),
      'utf8',
    ),
  ) as OffFixture;
  const packageMeasurement = normalizeMeasurement(
    fixture.product.product_quantity,
    fixture.product.product_quantity_unit,
  );
  const serving = normalizeMeasurement(
    fixture.product.serving_quantity,
    fixture.product.serving_quantity_unit,
  );
  return {
    fixture,
    row: productRow({
      barcode: fixture.code,
      name: fixture.product.product_name ?? 'Fixture product',
      brand: fixture.product.brands ?? null,
      imageUrl: fixture.product.image_front_url ?? null,
      packageSize: packageMeasurement
        ? new Prisma.Decimal(packageMeasurement.value)
        : null,
      packageBaseUnit: packageMeasurement?.baseUnit ?? null,
      servingSize: serving ? new Prisma.Decimal(serving.value) : null,
      servingBaseUnit: serving?.baseUnit ?? null,
      containerKey: mapOffPackagingShapes(fixture.product.packagings),
      sourceId: fixture.code,
    }),
  };
}

describe('resolvePackagedProductPortion', () => {
  it('resolves a coherent recorded VOLUME OFF product and ignores nutrition_data_per "100g"', () => {
    const { fixture, row } = recordedOffProduct('5449000000996');
    expect(fixture.product.nutrition_data_per).toBe('100g');

    expect(resolvePackagedProductPortion(row)).toEqual({
      resolution: {
        outcome: 'LOGGABLE',
        portionDimension: 'VOLUME',
        effectiveNutritionBasis: {
          basis: NutritionBasis.PER_100_ML,
          origin: 'INFERRED',
          source: ProductSource.OPEN_FOOD_FACTS,
          ruleId: 'OPEN_FOOD_FACTS_PORTION_DIMENSION',
        },
        package: { size: 330, baseUnit: BaseUnit.ML },
        serving: { size: 330, baseUnit: BaseUnit.ML },
        containerKey: ContainerKey.CAN,
      },
      diagnostics: { reasons: [], servingDiscardReason: null },
    });
  });

  it('resolves a recorded MASS package without fabricating a missing serving', () => {
    const { row } = recordedOffProduct('3017620422003');

    expect(resolvePackagedProductPortion(row).resolution).toEqual({
      outcome: 'LOGGABLE',
      portionDimension: 'MASS',
      effectiveNutritionBasis: {
        basis: NutritionBasis.PER_100_G,
        origin: 'INFERRED',
        source: ProductSource.OPEN_FOOD_FACTS,
        ruleId: 'OPEN_FOOD_FACTS_PORTION_DIMENSION',
      },
      package: { size: 400, baseUnit: BaseUnit.G },
      serving: null,
      containerKey: ContainerKey.JAR,
    });
  });

  it('uses a serving when no usable package exists', () => {
    const row = productRow({
      packageSize: null,
      packageBaseUnit: null,
      servingSize: new Prisma.Decimal(45),
      servingBaseUnit: BaseUnit.G,
    });

    expect(resolvePackagedProductPortion(row).resolution).toMatchObject({
      outcome: 'LOGGABLE',
      portionDimension: 'MASS',
      package: null,
      serving: { size: 45, baseUnit: BaseUnit.G },
    });
  });

  it('resolves a serving-only VOLUME OFF product with an Inferred nutrition basis', () => {
    const result = resolvePackagedProductPortion(
      productRow({
        packageSize: null,
        packageBaseUnit: null,
        servingSize: new Prisma.Decimal(250),
        servingBaseUnit: BaseUnit.ML,
      }),
    );

    expect(result.resolution).toEqual({
      outcome: 'LOGGABLE',
      portionDimension: 'VOLUME',
      effectiveNutritionBasis: {
        basis: NutritionBasis.PER_100_ML,
        origin: 'INFERRED',
        source: ProductSource.OPEN_FOOD_FACTS,
        ruleId: 'OPEN_FOOD_FACTS_PORTION_DIMENSION',
      },
      package: null,
      serving: { size: 250, baseUnit: BaseUnit.ML },
      containerKey: ContainerKey.PACKAGE,
    });
  });

  it('discards the conflicting serving in the recorded 330 ml / 330 g fixture', () => {
    const { row } = recordedOffProduct('5000112637922');
    const result = resolvePackagedProductPortion(row);

    expect(result.resolution).toMatchObject({
      outcome: 'LOGGABLE',
      portionDimension: 'VOLUME',
      package: { size: 330, baseUnit: BaseUnit.ML },
      serving: null,
    });
    expect(result.diagnostics.servingDiscardReason).toBe('DIMENSION_MISMATCH');
  });

  it('keeps the package authoritative over a larger cross-dimension serving', () => {
    const result = resolvePackagedProductPortion(
      productRow({
        packageSize: new Prisma.Decimal(500),
        packageBaseUnit: BaseUnit.ML,
        servingSize: new Prisma.Decimal(900),
        servingBaseUnit: BaseUnit.G,
      }),
    );

    expect(result.resolution).toMatchObject({
      outcome: 'LOGGABLE',
      portionDimension: 'VOLUME',
      package: { size: 500, baseUnit: BaseUnit.ML },
      serving: null,
    });
    expect(result.diagnostics.servingDiscardReason).toBe('DIMENSION_MISMATCH');
  });

  it('discards a same-dimension serving larger than its package', () => {
    const result = resolvePackagedProductPortion(
      productRow({
        packageSize: new Prisma.Decimal(330),
        packageBaseUnit: BaseUnit.ML,
        servingSize: new Prisma.Decimal(500),
        servingBaseUnit: BaseUnit.ML,
      }),
    );

    expect(result.resolution).toMatchObject({
      outcome: 'LOGGABLE',
      serving: null,
    });
    expect(result.diagnostics.servingDiscardReason).toBe('EXCEEDS_PACKAGE');
  });

  it('reports unknown Portion dimension before unknown Effective nutrition basis', () => {
    const result = resolvePackagedProductPortion(productRow());

    expect(result.resolution).toEqual({
      outcome: 'NOT_LOGGABLE',
      display: {
        name: 'Fixture product',
        brand: null,
        imageUrl: null,
      },
      subjectKind: 'PACKAGED_PRODUCT',
      primaryReason: 'PORTION_DIMENSION_UNKNOWN',
    });
    expect(result.diagnostics.reasons).toEqual([
      'PORTION_DIMENSION_UNKNOWN',
      'NUTRITION_BASIS_UNKNOWN',
    ]);
  });

  it('uses a Declared nutrition basis only after package and serving precedence', () => {
    const result = resolvePackagedProductPortion(
      productRow({
        source: ProductSource.ADMIN,
        declaredNutritionBasis: NutritionBasis.PER_100_ML,
      }),
    );

    expect(result.resolution).toMatchObject({
      outcome: 'LOGGABLE',
      portionDimension: 'VOLUME',
      effectiveNutritionBasis: {
        basis: NutritionBasis.PER_100_ML,
        origin: 'DECLARED',
      },
      package: null,
      serving: null,
      containerKey: ContainerKey.PACKAGE,
    });
  });

  it('uses the Declared nutrition basis before legacy user-submission inference', () => {
    const result = resolvePackagedProductPortion(
      productRow({
        source: ProductSource.USER_SUBMITTED,
        packageSize: new Prisma.Decimal(500),
        packageBaseUnit: BaseUnit.G,
        declaredNutritionBasis: NutritionBasis.PER_100_G,
      }),
    );

    expect(result.resolution).toMatchObject({
      outcome: 'LOGGABLE',
      portionDimension: 'MASS',
      effectiveNutritionBasis: {
        basis: NutritionBasis.PER_100_G,
        origin: 'DECLARED',
      },
      package: { size: 500, baseUnit: BaseUnit.G },
    });
  });

  it('reports a Declared nutrition basis conflict on a pre-existing row', () => {
    const result = resolvePackagedProductPortion(
      productRow({
        source: ProductSource.USER_SUBMITTED,
        packageSize: new Prisma.Decimal(500),
        packageBaseUnit: BaseUnit.ML,
        declaredNutritionBasis: NutritionBasis.PER_100_G,
      }),
    );

    expect(result.resolution).toMatchObject({
      outcome: 'NOT_LOGGABLE',
      subjectKind: 'PACKAGED_PRODUCT',
      primaryReason: 'DIMENSION_BASIS_CONFLICT',
    });
    expect(result.diagnostics.reasons).toEqual(['DIMENSION_BASIS_CONFLICT']);
  });

  it.each([
    {
      label: 'MASS package',
      packageSize: new Prisma.Decimal(100),
      packageBaseUnit: BaseUnit.G,
      servingSize: null,
      servingBaseUnit: null,
      outcome: 'LOGGABLE',
      primaryReason: undefined,
    },
    {
      label: 'VOLUME package',
      packageSize: new Prisma.Decimal(100),
      packageBaseUnit: BaseUnit.ML,
      servingSize: null,
      servingBaseUnit: null,
      outcome: 'NOT_LOGGABLE',
      primaryReason: 'NUTRITION_BASIS_UNKNOWN',
    },
    {
      label: 'MASS serving without package',
      packageSize: null,
      packageBaseUnit: null,
      servingSize: new Prisma.Decimal(30),
      servingBaseUnit: BaseUnit.G,
      outcome: 'NOT_LOGGABLE',
      primaryReason: 'NUTRITION_BASIS_UNKNOWN',
    },
  ])(
    'applies legacy user-submission grandfathering only for a $label',
    ({
      packageSize,
      packageBaseUnit,
      servingSize,
      servingBaseUnit,
      outcome,
      primaryReason,
    }) => {
      const result = resolvePackagedProductPortion(
        productRow({
          source: ProductSource.USER_SUBMITTED,
          packageSize,
          packageBaseUnit,
          servingSize,
          servingBaseUnit,
        }),
      );

      expect(result.resolution.outcome).toBe(outcome);
      if (result.resolution.outcome === 'LOGGABLE') {
        expect(result.resolution.effectiveNutritionBasis).toEqual({
          basis: NutritionBasis.PER_100_G,
          origin: 'INFERRED',
          source: ProductSource.USER_SUBMITTED,
          ruleId: 'LEGACY_USER_SUBMITTED_MASS_GRANDFATHERING',
        });
      } else {
        expect(result.resolution.primaryReason).toBe(primaryReason);
      }
    },
  );

  it('does not infer an Effective nutrition basis for ADMIN products', () => {
    const result = resolvePackagedProductPortion(
      productRow({
        source: ProductSource.ADMIN,
        packageSize: new Prisma.Decimal(100),
        packageBaseUnit: BaseUnit.G,
      }),
    );

    expect(result.resolution).toMatchObject({
      outcome: 'NOT_LOGGABLE',
      primaryReason: 'NUTRITION_BASIS_UNKNOWN',
    });
  });

  it('ignores nutrition_data_per "100ml" on the recorded ml multipack', () => {
    const { fixture, row } = recordedOffProduct('7613035833289');
    expect(fixture.product.nutrition_data_per).toBe('100ml');

    expect(resolvePackagedProductPortion(row).resolution).toMatchObject({
      outcome: 'LOGGABLE',
      portionDimension: 'VOLUME',
      effectiveNutritionBasis: {
        basis: NutritionBasis.PER_100_ML,
        origin: 'INFERRED',
        ruleId: 'OPEN_FOOD_FACTS_PORTION_DIMENSION',
      },
    });
  });
});
