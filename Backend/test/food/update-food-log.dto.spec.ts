import { BadRequestException, type ArgumentMetadata } from '@nestjs/common';
import { globalValidationPipe } from '../../src/common/pipes/validation.pipe';
import { UpdateFoodLogDto } from '../../src/modules/food/dto/update-food-log.dto';
import { FOOD_LOG_REJECTION_REASONS } from '../../src/modules/food/food-log-rejection-reasons';

const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: UpdateFoodLogDto,
  data: undefined,
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

describe('UpdateFoodLogDto through the global ValidationPipe', () => {
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
        rejectionReason({ amount, amountUnit: 'G' }),
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
          amount: 100,
          amountUnit: 'G',
          portionKind: 'SERVING',
          portionMultiplier: multiplier,
        }),
      ).resolves.toMatchObject({ reason });
    },
  );

  it('accepts meal-only and explicit amount updates', async () => {
    const mealOnly: unknown = await globalValidationPipe.transform(
      { mealCategory: 'DINNER' },
      metadata,
    );
    const explicit: unknown = await globalValidationPipe.transform(
      {
        amount: 330,
        amountUnit: 'ML',
        portionKind: 'PACKAGE',
        portionMultiplier: 1,
      },
      metadata,
    );

    expect(mealOnly).toMatchObject({ mealCategory: 'DINNER' });
    expect(explicit).toMatchObject({
      amount: 330,
      amountUnit: 'ML',
      portionKind: 'PACKAGE',
      portionMultiplier: 1,
    });
  });

  it('rejects the retired grams request field through the whitelist', async () => {
    await expect(
      globalValidationPipe.transform(
        { amount: 10, amountUnit: 'G', grams: 10 },
        metadata,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    [
      'amount without unit',
      { amount: 10 },
      FOOD_LOG_REJECTION_REASONS.AMOUNT_UNIT_REQUIRED,
    ],
    [
      'unit without amount',
      { amountUnit: 'G' },
      FOOD_LOG_REJECTION_REASONS.AMOUNT_UNIT_WITHOUT_AMOUNT,
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
    await expect(rejectionReason(input)).resolves.toMatchObject({ reason });
  });
});
