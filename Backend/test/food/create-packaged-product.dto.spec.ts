import { validate } from 'class-validator';
import { CreatePackagedProductDto } from '../../src/modules/food/dto/create-packaged-product.dto';

const validInput = {
  barcode: '3017620422003',
  name: 'Test product',
  caloriesPer100g: 100,
  proteinPer100g: 5,
  carbsPer100g: 12,
  fatPer100g: 3,
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
