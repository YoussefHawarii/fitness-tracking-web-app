import { validate } from 'class-validator';
import { NutritionBasis } from '@prisma/client';
import type { ArgumentMetadata } from '@nestjs/common';
import { CreatePackagedProductDto } from '../../src/modules/food/dto/create-packaged-product.dto';
import { globalValidationPipe } from '../../src/common/pipes/validation.pipe';

const validInput = {
  barcode: '3017620422003',
  name: 'Test product',
  declaredNutritionBasis: NutritionBasis.PER_100_G,
  caloriesPer100g: 100,
  proteinPer100g: 5,
  carbsPer100g: 12,
  fatPer100g: 3,
};

const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: CreatePackagedProductDto,
  data: undefined,
};

function dtoFrom(input: Record<string, unknown>): CreatePackagedProductDto {
  return Object.assign(new CreatePackagedProductDto(), input);
}

describe('CreatePackagedProductDto', () => {
  it.each([
    'name',
    'caloriesPer100g',
    'proteinPer100g',
    'carbsPer100g',
    'fatPer100g',
  ])('requires %s', async (field) => {
    const input: Record<string, unknown> = { ...validInput };
    delete input[field];

    const errors = await validate(dtoFrom(input));

    expect(errors.some((error) => error.property === field)).toBe(true);
  });

  it.each(['PER_SERVING', null])(
    'rejects an explicitly invalid Declared nutrition basis (%s)',
    async (declaredNutritionBasis) => {
      const errors = await validate(
        dtoFrom({ ...validInput, declaredNutritionBasis }),
      );

      expect(
        errors.some((error) => error.property === 'declaredNutritionBasis'),
      ).toBe(true);
    },
  );

  it('requires an explicit Declared basis', async () => {
    const input: Record<string, unknown> = { ...validInput };
    delete input.declaredNutritionBasis;

    const errors = await validate(dtoFrom(input));

    expect(
      errors.find((error) => error.property === 'declaredNutritionBasis')
        ?.constraints,
    ).toMatchObject({
      isDefined: 'DECLARED_NUTRITION_BASIS_REQUIRED',
    });

    await expect(
      globalValidationPipe.transform(input, metadata),
    ).rejects.toMatchObject({
      response: {
        reason: 'DECLARED_NUTRITION_BASIS_REQUIRED',
        message: 'declaredNutritionBasis is required.',
      },
    });
  });

  it.each([
    'caloriesPer100g',
    'proteinPer100g',
    'carbsPer100g',
    'fatPer100g',
    'fiberPer100g',
    'sugarPer100g',
    'sodiumPer100g',
  ])('rejects a negative %s value', async (field) => {
    const errors = await validate(dtoFrom({ ...validInput, [field]: -0.1 }));

    expect(errors.some((error) => error.property === field)).toBe(true);
  });

  it('accepts all optional product-description and serving fields', async () => {
    const errors = await validate(
      dtoFrom({
        ...validInput,
        nameAr: 'منتج اختبار',
        brand: 'Test Brand',
        category: 'Snacks',
        fiberPer100g: 1,
        sugarPer100g: 2,
        sodiumPer100g: 0.1,
        servingSize: 30,
        servingUnit: 'g',
        packageSize: 150,
        packageUnit: 'g',
        country: 'Egypt',
      }),
    );

    expect(errors).toEqual([]);
  });
});
