import type {
  BarcodeResolution,
  BaseUnit,
  ContainerKey,
  PortionKind,
} from '../../services/foodService';

export type LoggableBarcodeResolution = Extract<
  BarcodeResolution,
  { outcome: 'LOGGABLE' }
>;

export type PortionOptionId =
  | 'SERVING_HALF'
  | 'SERVING_ONE'
  | 'SERVING_TWO'
  | 'PACKAGE_ONE'
  | 'STORED'
  | 'CUSTOM';

export type PortionChoice =
  | {
      portionKind: 'PACKAGE' | 'SERVING';
      portionMultiplier: number;
      amount: number;
    }
  | {
      portionKind: 'CUSTOM';
      amount: number | null;
      portionMultiplier?: never;
    };

export interface StoredPortionChoice {
  portionKind: PortionKind | null;
  portionMultiplier?: number | null;
  amount: number;
  amountUnit: BaseUnit;
}

export interface PortionOption {
  id: PortionOptionId;
  label: string;
  baseUnit: BaseUnit;
  choice: PortionChoice;
}

export interface PortionSelection {
  optionId: PortionOptionId;
  choice: PortionChoice;
}

export interface PortionOptionsResult {
  options: PortionOption[];
  defaultSelection: PortionSelection | null;
}

const CONTAINER_NOUNS: Record<ContainerKey, string> = {
  PACKAGE: 'package',
  CAN: 'can',
  BOTTLE: 'bottle',
  JAR: 'jar',
  BOX: 'box',
  BAG: 'bag',
};

const CONTAINER_PLURALS: Record<ContainerKey, string> = {
  PACKAGE: 'packages',
  CAN: 'cans',
  BOTTLE: 'bottles',
  JAR: 'jars',
  BOX: 'boxes',
  BAG: 'bags',
};

function decimalParts(value: number): { coefficient: bigint; scale: number } {
  const match = value
    .toString()
    .match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match || !Number.isFinite(value)) {
    throw new Error('Portion amounts must be finite numbers.');
  }

  const sign = match[1] === '-' ? -1n : 1n;
  const fraction = match[3] ?? '';
  const exponent = Number(match[4] ?? 0);
  let coefficient = sign * BigInt(`${match[2]}${fraction}`);
  let scale = fraction.length - exponent;

  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }

  return { coefficient, scale };
}

export function multiplyAndRoundToOneDecimal(
  size: number,
  multiplier: number,
): number {
  const left = decimalParts(size);
  const right = decimalParts(multiplier);
  const product = left.coefficient * right.coefficient;
  const sign = product < 0n ? -1n : 1n;
  const absoluteProduct = product < 0n ? -product : product;
  const scale = left.scale + right.scale;

  let tenths: bigint;
  if (scale <= 1) {
    tenths = absoluteProduct * 10n ** BigInt(1 - scale);
  } else {
    const divisor = 10n ** BigInt(scale - 1);
    tenths = (absoluteProduct + divisor / 2n) / divisor;
  }

  return Number(sign * tenths) / 10;
}

function displayNumber(value: number): string {
  return value.toLocaleString('en-US', {
    useGrouping: false,
    maximumFractionDigits: 3,
  });
}

export function formatPortionAmount(
  amount: number,
  baseUnit: BaseUnit,
): string {
  if (amount >= 1000) {
    return `${displayNumber(amount / 1000)} ${baseUnit === 'ML' ? 'L' : 'kg'}`;
  }
  return `${displayNumber(amount)} ${baseUnit === 'ML' ? 'ml' : 'g'}`;
}

export function baseUnitForResolution(
  resolution: LoggableBarcodeResolution,
): BaseUnit {
  return resolution.effectiveNutritionBasis.basis === 'PER_100_ML' ? 'ML' : 'G';
}

function structuredOption(
  id: PortionOptionId,
  portionKind: 'PACKAGE' | 'SERVING',
  multiplier: number,
  size: number,
  baseUnit: BaseUnit,
  label: string,
  amount = multiplyAndRoundToOneDecimal(size, multiplier),
): PortionOption {
  return {
    id,
    label: `${label} (${formatPortionAmount(amount, baseUnit)})`,
    baseUnit,
    choice: { portionKind, portionMultiplier: multiplier, amount },
  };
}

function customOption(baseUnit: BaseUnit): PortionOption {
  return {
    id: 'CUSTOM',
    label: 'Custom amount',
    baseUnit,
    choice: { portionKind: 'CUSTOM', amount: null },
  };
}

function selectionFor(
  options: PortionOption[],
  optionId: PortionOptionId,
  choiceOverride?: PortionChoice,
): PortionSelection {
  const option = options.find(({ id }) => id === optionId);
  if (!option) throw new Error(`Missing portion option: ${optionId}`);
  return { optionId, choice: choiceOverride ?? option.choice };
}

function selectionForStoredChoice(
  options: PortionOption[],
  resolution: LoggableBarcodeResolution,
  storedChoice: StoredPortionChoice,
): PortionSelection {
  const customSelection = () =>
    selectionFor(options, 'CUSTOM', {
      portionKind: 'CUSTOM',
      amount: storedChoice.amount,
    });

  if (
    storedChoice.portionKind === null ||
    storedChoice.portionKind === 'CUSTOM'
  ) {
    return customSelection();
  }

  const multiplier = storedChoice.portionMultiplier;
  if (multiplier == null || !Number.isFinite(multiplier) || multiplier <= 0) {
    return customSelection();
  }

  const measurement =
    storedChoice.portionKind === 'PACKAGE'
      ? resolution.package
      : resolution.serving;
  if (!measurement || measurement.baseUnit !== storedChoice.amountUnit) {
    return customSelection();
  }

  const resolvedAmount = measurement.size * multiplier;
  if (Math.abs(resolvedAmount - storedChoice.amount) > 0.05) {
    return customSelection();
  }

  const matchingOption = options.find(({ choice, baseUnit }) => {
    if (choice.portionKind === 'CUSTOM') return false;
    return (
      choice.portionKind === storedChoice.portionKind &&
      choice.portionMultiplier === multiplier &&
      baseUnit === storedChoice.amountUnit &&
      Math.abs(choice.amount - storedChoice.amount) <= 0.05
    );
  });

  if (matchingOption) {
    return {
      optionId: matchingOption.id,
      choice: matchingOption.choice,
    };
  }

  const containerKey = resolution.containerKey;
  const noun = CONTAINER_NOUNS[containerKey] ?? 'package';
  const plural = CONTAINER_PLURALS[containerKey] ?? 'packages';
  const multiplierText = displayNumber(multiplier);
  const label =
    storedChoice.portionKind === 'SERVING'
      ? `${multiplierText} ${multiplier > 1 ? 'servings' : 'serving'}`
      : `${multiplierText} ${multiplier > 1 ? plural : noun}`;
  const storedOption = structuredOption(
    'STORED',
    storedChoice.portionKind,
    multiplier,
    measurement.size,
    measurement.baseUnit,
    label,
    storedChoice.amount,
  );
  options.splice(options.length - 1, 0, storedOption);
  return {
    optionId: storedOption.id,
    choice: storedOption.choice,
  };
}

/**
 * A stored choice is optional so creation and editing can share one resolver.
 * A stored structured choice is retained when current metadata still resolves
 * to its amount, adding a display option when no creation shortcut matches.
 * Metadata mismatches preserve the authoritative stored amount as custom.
 */
export function buildPortionOptions(
  resolution: LoggableBarcodeResolution,
  storedChoice?: StoredPortionChoice,
): PortionOptionsResult {
  const options: PortionOption[] = [];
  const serving = resolution.serving;
  const packageMeasurement = resolution.package;
  const baseUnit = baseUnitForResolution(resolution);

  if (serving) {
    options.push(
      structuredOption(
        'SERVING_HALF',
        'SERVING',
        0.5,
        serving.size,
        serving.baseUnit,
        '0.5 serving',
      ),
      structuredOption(
        'SERVING_ONE',
        'SERVING',
        1,
        serving.size,
        serving.baseUnit,
        '1 serving',
      ),
      structuredOption(
        'SERVING_TWO',
        'SERVING',
        2,
        serving.size,
        serving.baseUnit,
        '2 servings',
      ),
    );
  }

  if (packageMeasurement) {
    const noun = CONTAINER_NOUNS[resolution.containerKey] ?? 'package';
    const label = noun === 'package' ? 'Whole package' : `1 ${noun}`;
    options.push(
      structuredOption(
        'PACKAGE_ONE',
        'PACKAGE',
        1,
        packageMeasurement.size,
        packageMeasurement.baseUnit,
        label,
      ),
    );
  }

  options.push(customOption(baseUnit));

  if (storedChoice) {
    return {
      options,
      defaultSelection: selectionForStoredChoice(
        options,
        resolution,
        storedChoice,
      ),
    };
  }

  if (packageMeasurement && serving) {
    const isSameAmount =
      packageMeasurement.baseUnit === serving.baseUnit &&
      packageMeasurement.size === serving.size;
    return {
      options,
      defaultSelection: selectionFor(
        options,
        isSameAmount ? 'PACKAGE_ONE' : 'SERVING_ONE',
      ),
    };
  }

  if (serving) {
    return {
      options,
      defaultSelection: selectionFor(options, 'SERVING_ONE'),
    };
  }

  if (packageMeasurement) {
    return { options, defaultSelection: null };
  }

  return {
    options,
    defaultSelection: selectionFor(options, 'CUSTOM'),
  };
}
