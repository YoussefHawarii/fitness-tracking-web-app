export const TECHNICAL_INPUT_VALIDATION_REASONS = {
  NOT_NUMERIC: 'NOT_NUMERIC',
  NAN: 'NAN',
  NOT_FINITE: 'NOT_FINITE',
  ZERO: 'ZERO',
  NEGATIVE: 'NEGATIVE',
  TOO_PRECISE: 'TOO_PRECISE',
  TOO_LARGE: 'TOO_LARGE',
} as const;

export type TechnicalInputValidationReason =
  (typeof TECHNICAL_INPUT_VALIDATION_REASONS)[keyof typeof TECHNICAL_INPUT_VALIDATION_REASONS];

export type TechnicalInputValidationResult =
  | { ok: true; value: number }
  | { ok: false; reason: TechnicalInputValidationReason };

// The bound is 0 < amount < 1_000_000_000, exclusive. 1e9 is far inside the
// IEEE-754 double exact-integer range (2^53, about 9e15), so JSON round-trips
// exactly, and far inside DECIMAL(65,30)'s ceiling of about 1e35, so no column
// overflows. It is a technical limit, not a consumption maximum.
export const MAX_SAFE_CONSUMED_AMOUNT_INPUT = 1_000_000_000;

function decimalPlacesInShortestRepresentation(value: number): number {
  const representation = value.toString().toLowerCase();
  const exponentIndex = representation.indexOf('e');
  const coefficient =
    exponentIndex === -1
      ? representation
      : representation.slice(0, exponentIndex);
  const exponent =
    exponentIndex === -1 ? 0 : Number(representation.slice(exponentIndex + 1));
  const decimalPointIndex = coefficient.indexOf('.');
  const coefficientDecimalPlaces =
    decimalPointIndex === -1 ? 0 : coefficient.length - decimalPointIndex - 1;

  return Math.max(0, coefficientDecimalPlaces - exponent);
}

function validateTechnicalInput(
  value: unknown,
): TechnicalInputValidationResult {
  if (typeof value !== 'number') {
    return {
      ok: false,
      reason: TECHNICAL_INPUT_VALIDATION_REASONS.NOT_NUMERIC,
    };
  }
  if (Number.isNaN(value)) {
    return {
      ok: false,
      reason: TECHNICAL_INPUT_VALIDATION_REASONS.NAN,
    };
  }
  if (!Number.isFinite(value)) {
    return {
      ok: false,
      reason: TECHNICAL_INPUT_VALIDATION_REASONS.NOT_FINITE,
    };
  }
  if (value === 0) {
    return {
      ok: false,
      reason: TECHNICAL_INPUT_VALIDATION_REASONS.ZERO,
    };
  }
  if (value < 0) {
    return {
      ok: false,
      reason: TECHNICAL_INPUT_VALIDATION_REASONS.NEGATIVE,
    };
  }
  if (decimalPlacesInShortestRepresentation(value) > 1) {
    return {
      ok: false,
      reason: TECHNICAL_INPUT_VALIDATION_REASONS.TOO_PRECISE,
    };
  }
  if (value >= MAX_SAFE_CONSUMED_AMOUNT_INPUT) {
    return {
      ok: false,
      reason: TECHNICAL_INPUT_VALIDATION_REASONS.TOO_LARGE,
    };
  }

  return { ok: true, value };
}

export function validateConsumedAmount(
  value: unknown,
): TechnicalInputValidationResult {
  return validateTechnicalInput(value);
}

export function validatePortionMultiplier(
  value: unknown,
): TechnicalInputValidationResult {
  return validateTechnicalInput(value);
}
