import { TECHNICAL_INPUT_VALIDATION_REASONS } from './consumed-amount-validation';

// Public machine-readable reasons returned by food-log create/update
// validation and safety checks. Keep clients keyed to these stable values,
// while `message` remains free to be rewritten for people.
export const FOOD_LOG_REJECTION_REASONS = {
  ...TECHNICAL_INPUT_VALIDATION_REASONS,
  AMOUNT_REQUIRED: 'AMOUNT_REQUIRED',
  AMOUNT_UNIT_REQUIRED: 'AMOUNT_UNIT_REQUIRED',
  AMOUNT_UNIT_WITHOUT_AMOUNT: 'AMOUNT_UNIT_WITHOUT_AMOUNT',
  INVALID_AMOUNT_UNIT: 'INVALID_AMOUNT_UNIT',
  INVALID_PORTION_KIND: 'INVALID_PORTION_KIND',
  PORTION_MULTIPLIER_REQUIRED: 'PORTION_MULTIPLIER_REQUIRED',
  PORTION_MULTIPLIER_FORBIDDEN: 'PORTION_MULTIPLIER_FORBIDDEN',
  PORTION_MULTIPLIER_WITHOUT_PORTION_KIND:
    'PORTION_MULTIPLIER_WITHOUT_PORTION_KIND',
  OPEN_FOOD_FACTS_CREATE_RETIRED: 'OPEN_FOOD_FACTS_CREATE_RETIRED',
  AMOUNT_UNIT_BASIS_MISMATCH: 'AMOUNT_UNIT_BASIS_MISMATCH',
  MASS_SOURCE_REQUIRES_G: 'MASS_SOURCE_REQUIRES_G',
  PACKAGE_PORTION_UNAVAILABLE: 'PACKAGE_PORTION_UNAVAILABLE',
  SERVING_PORTION_UNAVAILABLE: 'SERVING_PORTION_UNAVAILABLE',
  PORTION_AMOUNT_MISMATCH: 'PORTION_AMOUNT_MISMATCH',
  DIMENSION_BASIS_CONFLICT: 'DIMENSION_BASIS_CONFLICT',
  PORTION_DIMENSION_UNKNOWN: 'PORTION_DIMENSION_UNKNOWN',
  NUTRITION_BASIS_UNKNOWN: 'NUTRITION_BASIS_UNKNOWN',
} as const;

export type FoodLogRejectionReason =
  (typeof FOOD_LOG_REJECTION_REASONS)[keyof typeof FOOD_LOG_REJECTION_REASONS];

export const FOOD_LOG_REJECTION_MESSAGES: Record<
  FoodLogRejectionReason,
  string
> = {
  NOT_NUMERIC: 'The amount must be a JSON number.',
  NAN: 'The amount must not be NaN.',
  NOT_FINITE: 'The amount must be finite.',
  ZERO: 'The amount must be greater than zero.',
  NEGATIVE: 'The amount must be greater than zero.',
  TOO_PRECISE: 'The amount may have at most one decimal place.',
  TOO_LARGE: 'The amount is outside the supported technical range.',
  AMOUNT_REQUIRED: 'amount is required.',
  AMOUNT_UNIT_REQUIRED: 'amountUnit is required when amount is provided.',
  AMOUNT_UNIT_WITHOUT_AMOUNT: 'amountUnit may only be provided with amount.',
  INVALID_AMOUNT_UNIT: 'amountUnit must be G or ML.',
  INVALID_PORTION_KIND: 'portionKind must be PACKAGE, SERVING, or CUSTOM.',
  PORTION_MULTIPLIER_REQUIRED:
    'portionMultiplier is required for a package or serving choice.',
  PORTION_MULTIPLIER_FORBIDDEN:
    'portionMultiplier is not allowed for a custom portion.',
  PORTION_MULTIPLIER_WITHOUT_PORTION_KIND:
    'portionMultiplier requires a portionKind.',
  OPEN_FOOD_FACTS_CREATE_RETIRED:
    'New Open Food Facts log entries must use a cached packaged product.',
  AMOUNT_UNIT_BASIS_MISMATCH:
    "The amount unit does not match the product's nutrition basis.",
  MASS_SOURCE_REQUIRES_G: 'This food source accepts amounts in grams only.',
  PACKAGE_PORTION_UNAVAILABLE:
    'The product does not have a usable package size.',
  SERVING_PORTION_UNAVAILABLE:
    'The product does not have a usable serving size.',
  PORTION_AMOUNT_MISMATCH:
    'The amount does not match the selected package or serving quantity.',
  DIMENSION_BASIS_CONFLICT:
    "The product's portion dimension conflicts with its nutrition basis.",
  PORTION_DIMENSION_UNKNOWN:
    'The product does not have a usable portion dimension.',
  NUTRITION_BASIS_UNKNOWN:
    'The product does not have a usable nutrition basis.',
};

export function isFoodLogRejectionReason(
  value: string,
): value is FoodLogRejectionReason {
  return Object.values(FOOD_LOG_REJECTION_REASONS).some(
    (reason) => reason === value,
  );
}
