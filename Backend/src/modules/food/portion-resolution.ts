import {
  BaseUnit,
  ContainerKey,
  NutritionBasis,
  ProductSource,
  type PackagedProduct,
  type Prisma,
} from '@prisma/client';

export type PortionDimension = 'MASS' | 'VOLUME' | 'UNKNOWN';

export type NutritionBasisRuleId =
  | 'OPEN_FOOD_FACTS_PORTION_DIMENSION'
  | 'LEGACY_USER_SUBMITTED_MASS_GRANDFATHERING';

export type NotLoggableReason =
  | 'DIMENSION_BASIS_CONFLICT'
  | 'PORTION_DIMENSION_UNKNOWN'
  | 'NUTRITION_BASIS_UNKNOWN';

export type ServingDiscardReason = 'DIMENSION_MISMATCH' | 'EXCEEDS_PACKAGE';

export type EffectiveNutritionBasis =
  | {
      basis: NutritionBasis;
      origin: 'DECLARED';
    }
  | {
      basis: NutritionBasis;
      origin: 'INFERRED';
      source: ProductSource;
      ruleId: NutritionBasisRuleId;
    };

export interface ResolvedMeasurement {
  size: number;
  baseUnit: BaseUnit;
}

export interface ProductDisplayData {
  name: string;
  brand: string | null;
  imageUrl: string | null;
}

export type PortionResolution =
  | {
      outcome: 'LOGGABLE';
      portionDimension: Exclude<PortionDimension, 'UNKNOWN'>;
      effectiveNutritionBasis: EffectiveNutritionBasis;
      package: ResolvedMeasurement | null;
      serving: ResolvedMeasurement | null;
      containerKey: ContainerKey;
    }
  | {
      outcome: 'NOT_LOGGABLE';
      display: ProductDisplayData;
      subjectKind: 'PACKAGED_PRODUCT';
      primaryReason: NotLoggableReason;
    };

export interface PortionResolutionDiagnostics {
  reasons: NotLoggableReason[];
  servingDiscardReason: ServingDiscardReason | null;
}

export interface PortionResolutionResult {
  resolution: PortionResolution;
  diagnostics: PortionResolutionDiagnostics;
}

type NumericValue = number | Prisma.Decimal | null;

type PortionResolvableProduct = Pick<
  PackagedProduct,
  | 'name'
  | 'brand'
  | 'imageUrl'
  | 'source'
  | 'packageSize'
  | 'packageBaseUnit'
  | 'servingSize'
  | 'servingBaseUnit'
  | 'containerKey'
  | 'declaredNutritionBasis'
>;

const PRIMARY_REASON_ORDER: readonly NotLoggableReason[] = [
  'DIMENSION_BASIS_CONFLICT',
  'PORTION_DIMENSION_UNKNOWN',
  'NUTRITION_BASIS_UNKNOWN',
];

function resolvedMeasurement(
  size: NumericValue,
  baseUnit: BaseUnit | null,
): ResolvedMeasurement | null {
  if (!baseUnit || size === null) return null;
  const numericSize = Number(size);
  if (!Number.isFinite(numericSize) || numericSize <= 0) return null;
  return { size: numericSize, baseUnit };
}

function dimensionForBaseUnit(
  baseUnit: BaseUnit,
): Exclude<PortionDimension, 'UNKNOWN'> {
  return baseUnit === BaseUnit.G ? 'MASS' : 'VOLUME';
}

function dimensionForBasis(
  basis: NutritionBasis,
): Exclude<PortionDimension, 'UNKNOWN'> {
  return basis === NutritionBasis.PER_100_G ? 'MASS' : 'VOLUME';
}

function inferredBasis(
  product: PortionResolvableProduct,
  portionDimension: PortionDimension,
  packageMeasurement: ResolvedMeasurement | null,
): EffectiveNutritionBasis | null {
  if (product.source === ProductSource.OPEN_FOOD_FACTS) {
    if (portionDimension === 'UNKNOWN') return null;
    return {
      basis:
        portionDimension === 'MASS'
          ? NutritionBasis.PER_100_G
          : NutritionBasis.PER_100_ML,
      origin: 'INFERRED',
      source: ProductSource.OPEN_FOOD_FACTS,
      ruleId: 'OPEN_FOOD_FACTS_PORTION_DIMENSION',
    };
  }

  if (
    product.source === ProductSource.USER_SUBMITTED &&
    packageMeasurement?.baseUnit === BaseUnit.G
  ) {
    return {
      basis: NutritionBasis.PER_100_G,
      origin: 'INFERRED',
      source: ProductSource.USER_SUBMITTED,
      ruleId: 'LEGACY_USER_SUBMITTED_MASS_GRANDFATHERING',
    };
  }

  return null;
}

export function resolvePackagedProductPortion(
  product: PortionResolvableProduct,
): PortionResolutionResult {
  const packageMeasurement = resolvedMeasurement(
    product.packageSize,
    product.packageBaseUnit,
  );
  const storedServing = resolvedMeasurement(
    product.servingSize,
    product.servingBaseUnit,
  );

  let serving = storedServing;
  let servingDiscardReason: ServingDiscardReason | null = null;
  if (packageMeasurement && serving) {
    if (packageMeasurement.baseUnit !== serving.baseUnit) {
      serving = null;
      servingDiscardReason = 'DIMENSION_MISMATCH';
    } else if (serving.size > packageMeasurement.size) {
      serving = null;
      servingDiscardReason = 'EXCEEDS_PACKAGE';
    }
  }

  const measurementDimension = packageMeasurement
    ? dimensionForBaseUnit(packageMeasurement.baseUnit)
    : serving
      ? dimensionForBaseUnit(serving.baseUnit)
      : null;
  const portionDimension: PortionDimension =
    measurementDimension ??
    (product.declaredNutritionBasis
      ? dimensionForBasis(product.declaredNutritionBasis)
      : 'UNKNOWN');

  const effectiveNutritionBasis: EffectiveNutritionBasis | null =
    product.declaredNutritionBasis
      ? {
          basis: product.declaredNutritionBasis,
          origin: 'DECLARED',
        }
      : inferredBasis(product, portionDimension, packageMeasurement);

  const reasons: NotLoggableReason[] = [];
  if (
    product.declaredNutritionBasis &&
    measurementDimension &&
    dimensionForBasis(product.declaredNutritionBasis) !== measurementDimension
  ) {
    reasons.push('DIMENSION_BASIS_CONFLICT');
  }
  if (portionDimension === 'UNKNOWN') {
    reasons.push('PORTION_DIMENSION_UNKNOWN');
  }
  if (!effectiveNutritionBasis) {
    reasons.push('NUTRITION_BASIS_UNKNOWN');
  }

  const diagnostics: PortionResolutionDiagnostics = {
    reasons,
    servingDiscardReason,
  };

  if (reasons.length > 0) {
    const primaryReason = PRIMARY_REASON_ORDER.find((reason) =>
      reasons.includes(reason),
    );
    if (!primaryReason) {
      throw new Error('A Not scalable product must have a primary reason.');
    }
    return {
      resolution: {
        outcome: 'NOT_LOGGABLE',
        display: {
          name: product.name,
          brand: product.brand,
          imageUrl: product.imageUrl,
        },
        subjectKind: 'PACKAGED_PRODUCT',
        primaryReason,
      },
      diagnostics,
    };
  }

  if (portionDimension === 'UNKNOWN' || !effectiveNutritionBasis) {
    throw new Error('A loggable product must have safe portion semantics.');
  }

  return {
    resolution: {
      outcome: 'LOGGABLE',
      portionDimension,
      effectiveNutritionBasis,
      package: packageMeasurement,
      serving,
      containerKey: product.containerKey ?? ContainerKey.PACKAGE,
    },
    diagnostics,
  };
}
