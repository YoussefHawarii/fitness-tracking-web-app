import { BadRequestException, type ArgumentMetadata } from '@nestjs/common';
import { globalValidationPipe } from '../../src/common/pipes/validation.pipe';
import { CreateFoodLogDto } from '../../src/modules/food/dto/create-food-log.dto';
import { FOOD_LOG_REJECTION_REASONS } from '../../src/modules/food/food-log-rejection-reasons';

const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: CreateFoodLogDto,
  data: undefined,
};

const base = {
  sourceType: 'LOCAL',
  sourceRef: 'local-1',
  mealCategory: 'LUNCH',
  loggedAtUtc: '2026-09-28T12:00:00.000Z',
};

async function rejectionReason(body: Record<string, unknown>) {
  try {
    await globalValidationPipe.transform(body, metadata);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse() as {
      message: string;
      reason: string;
    };
  }
  throw new Error('Expected request validation to reject.');
}

describe('CreateFoodLogDto through the global ValidationPipe', () => {
  it.each([
    ['string', '12', FOOD_LOG_REJECTION_REASONS.NOT_NUMERIC],
    ['object', { value: 12 }, FOOD_LOG_REJECTION_REASONS.NOT_NUMERIC],
    ['NaN', Number.NaN, FOOD_LOG_REJECTION_REASONS.NAN],
    [
      'Infinity',
      Number.POSITIVE_INFINITY,
      FOOD_LOG_REJECTION_REASONS.NOT_FINITE,
    ],
    ['zero', 0, FOOD_LOG_REJECTION_REASONS.ZERO],
    ['negative', -1, FOOD_LOG_REJECTION_REASONS.NEGATIVE],
    ['two decimals', 1.25, FOOD_LOG_REJECTION_REASONS.TOO_PRECISE],
    ['technical bound', 1_000_000_000, FOOD_LOG_REJECTION_REASONS.TOO_LARGE],
  ])(
    'rejects a %s amount with its technical reason',
    async (_label, amount, reason) => {
      await expect(
        rejectionReason({ ...base, amount, amountUnit: 'G' }),
      ).resolves.toMatchObject({ reason });
    },
  );

  it.each([
    ['NaN', Number.NaN, FOOD_LOG_REJECTION_REASONS.NAN],
    [
      'Infinity',
      Number.NEGATIVE_INFINITY,
      FOOD_LOG_REJECTION_REASONS.NOT_FINITE,
    ],
    ['zero', 0, FOOD_LOG_REJECTION_REASONS.ZERO],
    ['negative', -0.5, FOOD_LOG_REJECTION_REASONS.NEGATIVE],
    ['two decimals', 0.25, FOOD_LOG_REJECTION_REASONS.TOO_PRECISE],
    ['technical bound', 1_000_000_000, FOOD_LOG_REJECTION_REASONS.TOO_LARGE],
    ['string', '1', FOOD_LOG_REJECTION_REASONS.NOT_NUMERIC],
  ])(
    'rejects a %s multiplier with its technical reason',
    async (_label, multiplier, reason) => {
      await expect(
        rejectionReason({
          ...base,
          amount: 100,
          amountUnit: 'G',
          portionKind: 'SERVING',
          portionMultiplier: multiplier,
        }),
      ).resolves.toMatchObject({ reason });
    },
  );

  it('accepts the legacy grams representation and the explicit representation', async () => {
    const legacy: unknown = await globalValidationPipe.transform(
      { ...base, grams: 999_999_999.9 },
      metadata,
    );
    const explicit: unknown = await globalValidationPipe.transform(
      {
        ...base,
        amount: 330,
        amountUnit: 'ML',
        portionKind: 'CUSTOM',
      },
      metadata,
    );

    expect(legacy).toMatchObject({ grams: 999_999_999.9 });
    expect(explicit).toMatchObject({
      amount: 330,
      amountUnit: 'ML',
      portionKind: 'CUSTOM',
    });
  });

  it.each([
    [
      'neither amount field',
      {},
      FOOD_LOG_REJECTION_REASONS.EXACTLY_ONE_AMOUNT_REPRESENTATION_REQUIRED,
    ],
    [
      'both amount fields',
      { grams: 10, amount: 10, amountUnit: 'G' },
      FOOD_LOG_REJECTION_REASONS.EXACTLY_ONE_AMOUNT_REPRESENTATION_REQUIRED,
    ],
    [
      'amount without unit',
      { amount: 10 },
      FOOD_LOG_REJECTION_REASONS.AMOUNT_UNIT_REQUIRED,
    ],
    [
      'unit without amount',
      { grams: 10, amountUnit: 'G' },
      FOOD_LOG_REJECTION_REASONS.AMOUNT_UNIT_WITHOUT_AMOUNT,
    ],
    [
      'portion fields on legacy grams',
      { grams: 10, portionKind: 'CUSTOM' },
      FOOD_LOG_REJECTION_REASONS.LEGACY_GRAMS_PORTION_FIELDS_FORBIDDEN,
    ],
    [
      'structured choice without multiplier',
      { amount: 10, amountUnit: 'G', portionKind: 'PACKAGE' },
      FOOD_LOG_REJECTION_REASONS.PORTION_MULTIPLIER_REQUIRED,
    ],
    [
      'custom choice with multiplier',
      {
        amount: 10,
        amountUnit: 'G',
        portionKind: 'CUSTOM',
        portionMultiplier: 1,
      },
      FOOD_LOG_REJECTION_REASONS.PORTION_MULTIPLIER_FORBIDDEN,
    ],
    [
      'multiplier without a choice',
      { amount: 10, amountUnit: 'G', portionMultiplier: 1 },
      FOOD_LOG_REJECTION_REASONS.PORTION_MULTIPLIER_WITHOUT_PORTION_KIND,
    ],
    [
      'invalid amount unit',
      { amount: 10, amountUnit: 'L' },
      FOOD_LOG_REJECTION_REASONS.INVALID_AMOUNT_UNIT,
    ],
    [
      'invalid portion kind',
      { amount: 10, amountUnit: 'G', portionKind: 'BOWL' },
      FOOD_LOG_REJECTION_REASONS.INVALID_PORTION_KIND,
    ],
  ])('rejects the forbidden combination: %s', async (_label, input, reason) => {
    await expect(rejectionReason({ ...base, ...input })).resolves.toMatchObject(
      {
        reason,
      },
    );
  });
});
