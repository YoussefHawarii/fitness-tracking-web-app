import { BaseUnit, ContainerKey } from '@prisma/client';
import { OpenFoodFactsProvider } from '../../src/modules/food/providers/open-food-facts.provider';

describe('OpenFoodFactsProvider contract', () => {
  it('carries a client miss through as not found', async () => {
    const client = {
      lookupByBarcode: jest.fn().mockResolvedValue({ outcome: 'NOT_FOUND' }),
    };
    const provider = new OpenFoodFactsProvider(client as never);

    await expect(provider.lookupByBarcode('5449000000996')).resolves.toEqual({
      outcome: 'NOT_FOUND',
    });
  });

  it('carries normalized portion and container metadata into the provider-neutral result', async () => {
    const client = {
      lookupByBarcode: jest.fn().mockResolvedValue({
        outcome: 'FOUND_WITH_NUTRITION',
        barcode: '5449000000996',
        name: 'Coca-Cola',
        caloriesPer100g: 42,
        proteinPer100g: null,
        carbsPer100g: 10.6,
        fatPer100g: 0,
        servingSize: 330,
        servingUnit: 'ml',
        servingBaseUnit: BaseUnit.ML,
        packageSize: 330,
        packageUnit: 'ml',
        packageBaseUnit: BaseUnit.ML,
        containerKey: ContainerKey.CAN,
      }),
    };
    const provider = new OpenFoodFactsProvider(client as never);

    const result = await provider.lookupByBarcode('5449000000996');
    expect(result.outcome).toBe('FOUND_WITH_NUTRITION');
    if (result.outcome !== 'FOUND_WITH_NUTRITION') return;
    expect(result.product).toMatchObject({
      servingSize: 330,
      servingUnit: 'ml',
      servingBaseUnit: BaseUnit.ML,
      packageSize: 330,
      packageUnit: 'ml',
      packageBaseUnit: BaseUnit.ML,
      containerKey: ContainerKey.CAN,
      sourceId: '5449000000996',
    });
  });

  it.each([undefined, 'portion'])(
    'drops a size whose client unit is %s',
    async (packageUnit) => {
      const client = {
        lookupByBarcode: jest.fn().mockResolvedValue({
          outcome: 'FOUND_WITH_NUTRITION',
          barcode: '5449000000996',
          name: 'Coca-Cola',
          caloriesPer100g: 42,
          packageSize: 330,
          packageUnit,
          packageBaseUnit: BaseUnit.ML,
          containerKey: ContainerKey.CAN,
        }),
      };
      const provider = new OpenFoodFactsProvider(client as never);

      const result = await provider.lookupByBarcode('5449000000996');
      expect(result.outcome).toBe('FOUND_WITH_NUTRITION');
      if (result.outcome !== 'FOUND_WITH_NUTRITION') return;
      expect(result.product).toMatchObject({
        packageSize: null,
        packageUnit: null,
        packageBaseUnit: null,
      });
    },
  );

  it('passes a null container key through the provider contract', async () => {
    const client = {
      lookupByBarcode: jest.fn().mockResolvedValue({
        outcome: 'FOUND_WITH_NUTRITION',
        barcode: '5449000000996',
        name: 'Coca-Cola',
        caloriesPer100g: 42,
        packageSize: 330,
        packageUnit: 'ml',
        packageBaseUnit: BaseUnit.ML,
        containerKey: null,
      }),
    };
    const provider = new OpenFoodFactsProvider(client as never);

    const result = await provider.lookupByBarcode('5449000000996');
    expect(result.outcome).toBe('FOUND_WITH_NUTRITION');
    if (result.outcome !== 'FOUND_WITH_NUTRITION') return;
    expect(result.product.containerKey).toBeNull();
  });

  it('carries identified display data without inventing nutrition', async () => {
    const client = {
      lookupByBarcode: jest.fn().mockResolvedValue({
        outcome: 'FOUND_WITHOUT_NUTRITION',
        identification: {
          barcode: '5449000000996',
          name: 'Known drink',
          brand: 'Known brand',
          imageUrl: 'https://images.example/known.jpg',
        },
      }),
    };
    const provider = new OpenFoodFactsProvider(client as never);

    await expect(provider.lookupByBarcode('5449000000996')).resolves.toEqual({
      outcome: 'FOUND_WITHOUT_NUTRITION',
      identification: {
        name: 'Known drink',
        brand: 'Known brand',
        imageUrl: 'https://images.example/known.jpg',
      },
    });
  });
});
