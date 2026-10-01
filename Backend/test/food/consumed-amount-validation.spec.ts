import {
  MAX_SAFE_CONSUMED_AMOUNT_INPUT,
  TECHNICAL_INPUT_VALIDATION_REASONS,
  validateConsumedAmount,
  validatePortionMultiplier,
} from '../../src/modules/food/consumed-amount-validation';
import type {
  TechnicalInputValidationReason,
  TechnicalInputValidationResult,
} from '../../src/modules/food/consumed-amount-validation';

type Validator = (value: unknown) => TechnicalInputValidationResult;

const REJECTED_NUMBER_CASES: ReadonlyArray<
  readonly [string, number, TechnicalInputValidationReason]
> = [
  ['NaN', NaN, TECHNICAL_INPUT_VALIDATION_REASONS.NAN],
  ['Infinity', Infinity, TECHNICAL_INPUT_VALIDATION_REASONS.NOT_FINITE],
  [
    'negative Infinity',
    -Infinity,
    TECHNICAL_INPUT_VALIDATION_REASONS.NOT_FINITE,
  ],
  ['zero', 0, TECHNICAL_INPUT_VALIDATION_REASONS.ZERO],
  ['negative zero', -0, TECHNICAL_INPUT_VALIDATION_REASONS.ZERO],
  ['a negative number', -1, TECHNICAL_INPUT_VALIDATION_REASONS.NEGATIVE],
  ['two decimal places', 62.85, TECHNICAL_INPUT_VALIDATION_REASONS.TOO_PRECISE],
  [
    'a small value with two decimal places',
    0.05,
    TECHNICAL_INPUT_VALIDATION_REASONS.TOO_PRECISE,
  ],
  [
    'exponent notation below one decimal place',
    1e-7,
    TECHNICAL_INPUT_VALIDATION_REASONS.TOO_PRECISE,
  ],
  [
    'the exclusive upper bound',
    1_000_000_000,
    TECHNICAL_INPUT_VALIDATION_REASONS.TOO_LARGE,
  ],
  [
    'a large value in exponent notation',
    1e21,
    TECHNICAL_INPUT_VALIDATION_REASONS.TOO_LARGE,
  ],
  // Precision is checked before magnitude.
  [
    'an oversized value with two decimal places',
    1_000_000_000.11,
    TECHNICAL_INPUT_VALIDATION_REASONS.TOO_PRECISE,
  ],
];

const NON_NUMBER_CASES: ReadonlyArray<readonly [string, unknown]> = [
  ['numeric string', '12'],
  ['null', null],
  ['undefined', undefined],
  ['true', true],
  ['false', false],
  ['object', {}],
  ['array', []],
];

const ACCEPTED_CASES: ReadonlyArray<readonly [string, number]> = [
  ['just below the exclusive upper bound', 999_999_999.9],
  ['one decimal place below one', 0.1],
  ['one decimal place', 62.8],
];

it('exports the exclusive technical input bound', () => {
  expect(MAX_SAFE_CONSUMED_AMOUNT_INPUT).toBe(1_000_000_000);
});

function describeValidator(name: string, validator: Validator): void {
  describe(name, () => {
    it.each(REJECTED_NUMBER_CASES)('rejects %s', (_label, value, reason) => {
      expect(validator(value)).toEqual({ ok: false, reason });
    });

    it.each(NON_NUMBER_CASES)('rejects a %s', (_label, value) => {
      expect(validator(value)).toEqual({
        ok: false,
        reason: TECHNICAL_INPUT_VALIDATION_REASONS.NOT_NUMERIC,
      });
    });

    it.each(ACCEPTED_CASES)('accepts %s', (_label, value) => {
      expect(validator(value)).toEqual({ ok: true, value });
    });
  });
}

describeValidator('validateConsumedAmount', validateConsumedAmount);
describeValidator('validatePortionMultiplier', validatePortionMultiplier);
