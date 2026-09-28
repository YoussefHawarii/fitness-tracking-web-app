import { BaseUnit, ContainerKey } from '@prisma/client';
import { OpenFoodFactsProvider } from '../../src/modules/food/providers/open-food-facts.provider';

describe('OpenFoodFactsProvider contract', () => {
  it('returns null when the client misses', async () => {
    const client = { lookupByBarcode: jest.fn().mockResolvedValue(null) };
    const provider = new OpenFoodFactsProvider(client as never);

    await expect(provider.lookupByBarcode('5449000000996')).resolves.toBeNull();
  });

  it('carries normalized portion and container metadata into the provider-neutral result', async () => {
    const client = {
      lookupByBarcode: jest.fn().mockResolvedValue({
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

    await expect(provider.lookupByBarcode('5449000000996')).resolves.toEqual(
      expect.objectContaining({
        servingSize: 330,
        servingUnit: 'ml',
        servingBaseUnit: BaseUnit.ML,
        packageSize: 330,
        packageUnit: 'ml',
        packageBaseUnit: BaseUnit.ML,
        containerKey: ContainerKey.CAN,
        sourceId: '5449000000996',
      }),
    );
  });

  it.each([undefined, 'portion'])(
    'drops a size whose client unit is %s',
    async (packageUnit) => {
      const client = {
        lookupByBarcode: jest.fn().mockResolvedValue({
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

      await expect(provider.lookupByBarcode('5449000000996')).resolves.toEqual(
        expect.objectContaining({
          packageSize: null,
          packageUnit: null,
          packageBaseUnit: null,
        }),
      );
    },
  );

  it('passes a null container key through the provider contract', async () => {
    const client = {
      lookupByBarcode: jest.fn().mockResolvedValue({
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

    await expect(provider.lookupByBarcode('5449000000996')).resolves.toEqual(
      expect.objectContaining({ containerKey: null }),
    );
  });
});
