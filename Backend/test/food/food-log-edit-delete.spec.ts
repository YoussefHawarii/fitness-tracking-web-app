import { NotFoundException } from '@nestjs/common';
import { FoodService } from '../../src/modules/food/food.service';

// Covers specs/007-date-picker-food-log-edit/data-model.md:
// updateFoodLog recomputes nutrients from stored source; both methods
// enforce ownership the same way CalorieBalanceService's exercise-log
// edit/delete do.
describe('FoodService — updateFoodLog / deleteFoodLog', () => {
  const userId = 'user-1';

  function buildService(
    overrides: {
      existing?: Partial<Record<string, unknown>>;
      localItem?: Partial<Record<string, unknown>> | null;
      openFoodFactsProduct?: Partial<Record<string, unknown>> | null;
    } = {},
  ) {
    const existing = {
      id: 'log-1',
      userId,
      sourceType: 'LOCAL',
      sourceRef: 'local-1',
      name: "Mom's lasagna",
      localFoodItemId: 'local-1',
      grams: 100,
      mealCategory: 'LUNCH',
      ...overrides.existing,
    };

    const updateCalls: Record<string, unknown>[] = [];
    const prisma = {
      foodLogEntry: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn((args: { data: Record<string, unknown> }) => {
          updateCalls.push(args.data);
          return Promise.resolve({ ...existing, ...args.data });
        }),
        delete: jest.fn().mockResolvedValue(existing),
      },
      localFoodItem: {
        findFirst: jest.fn().mockResolvedValue(
          overrides.localItem === null
            ? null
            : {
                id: 'local-1',
                name: "Mom's lasagna",
                caloriesPer100g: 200,
                proteinPer100g: null,
                carbsPer100g: null,
                fatPer100g: null,
                ...overrides.localItem,
              },
        ),
      },
    };
    const openFoodFacts = {
      lookupByBarcode: jest.fn().mockResolvedValue(
        overrides.openFoodFactsProduct === null
          ? null
          : overrides.openFoodFactsProduct
            ? {
                name: 'Legacy barcode product',
                caloriesPer100g: 250,
                proteinPer100g: 5,
                carbsPer100g: 30,
                fatPer100g: 10,
                ...overrides.openFoodFactsProduct,
              }
            : undefined,
      ),
    };
    const usda = { searchByTerm: jest.fn() };
    const barcodeCache = { get: () => null, set: () => undefined };
    const productResolver = { resolveBarcode: jest.fn() };
    const packagedProducts = { findById: jest.fn() };

    const service = new FoodService(
      prisma as never,
      openFoodFacts as never,
      usda as never,
      barcodeCache as never,
      productResolver as never,
      packagedProducts as never,
    );
    return { service, prisma, updateCalls, openFoodFacts, packagedProducts };
  }

  it('recomputes calories proportionally to the new grams', async () => {
    const { service, updateCalls } = buildService({
      existing: { grams: 100 },
    });

    await service.updateFoodLog(userId, 'log-1', { grams: 250 });

    expect(updateCalls[0].grams).toBe(250);
    // 200 cal/100g * 250g = 500
    expect(updateCalls[0].caloriesComputed).toBe(500);
  });

  it('updates mealCategory without requiring grams', async () => {
    const { service, updateCalls, prisma } = buildService();

    await service.updateFoodLog(userId, 'log-1', { mealCategory: 'DINNER' });

    expect(updateCalls[0]).toEqual({ mealCategory: 'DINNER' });
    expect(prisma.localFoodItem.findFirst).not.toHaveBeenCalled();
  });

  it('accepts the explicit G update shape for a mass source', async () => {
    const { service, updateCalls } = buildService();

    await service.updateFoodLog(userId, 'log-1', {
      amount: 80,
      amountUnit: 'G',
      portionKind: 'CUSTOM',
      mealCategory: 'DINNER',
    });

    expect(updateCalls[0]).toMatchObject({
      grams: 80,
      amount: 80,
      amountUnit: 'G',
      portionKind: 'CUSTOM',
      portionMultiplier: null,
      caloriesComputed: 160,
      mealCategory: 'DINNER',
    });
  });

  it('rejects ML and structured package choices for mass sources', async () => {
    const { service, prisma } = buildService();

    await expect(
      service.updateFoodLog(userId, 'log-1', {
        amount: 80,
        amountUnit: 'ML',
        portionKind: 'CUSTOM',
      }),
    ).rejects.toMatchObject({
      response: { reason: 'MASS_SOURCE_REQUIRES_G' },
    });
    await expect(
      service.updateFoodLog(userId, 'log-1', {
        amount: 80,
        amountUnit: 'G',
        portionKind: 'PACKAGE',
        portionMultiplier: 1,
      }),
    ).rejects.toMatchObject({
      response: { reason: 'PACKAGE_PORTION_UNAVAILABLE' },
    });
    expect(prisma.foodLogEntry.update).not.toHaveBeenCalled();
  });

  it('still edits a pre-feature OPEN_FOOD_FACTS log without a PackagedProduct relation', async () => {
    const { service, updateCalls, openFoodFacts, packagedProducts } =
      buildService({
        existing: {
          sourceType: 'OPEN_FOOD_FACTS',
          sourceRef: '3017620422003',
          localFoodItemId: null,
          packagedProductId: null,
        },
        openFoodFactsProduct: {},
      });

    await service.updateFoodLog(userId, 'log-1', { grams: 40 });

    expect(openFoodFacts.lookupByBarcode).toHaveBeenCalledWith('3017620422003');
    expect(packagedProducts.findById).not.toHaveBeenCalled();
    expect(updateCalls[0].caloriesComputed).toBe(100);
  });

  it('rejects an ML amount for a legacy OPEN_FOOD_FACTS entry', async () => {
    const { service, prisma, openFoodFacts } = buildService({
      existing: {
        sourceType: 'OPEN_FOOD_FACTS',
        sourceRef: '3017620422003',
        localFoodItemId: null,
        packagedProductId: null,
      },
    });

    await expect(
      service.updateFoodLog(userId, 'log-1', {
        amount: 80,
        amountUnit: 'ML',
        portionKind: 'CUSTOM',
      }),
    ).rejects.toMatchObject({
      response: { reason: 'MASS_SOURCE_REQUIRES_G' },
    });
    expect(openFoodFacts.lookupByBarcode).not.toHaveBeenCalled();
    expect(prisma.foodLogEntry.update).not.toHaveBeenCalled();
  });

  it('rejects a structured package choice for a legacy OPEN_FOOD_FACTS entry', async () => {
    const { service, prisma, openFoodFacts } = buildService({
      existing: {
        sourceType: 'OPEN_FOOD_FACTS',
        sourceRef: '3017620422003',
        localFoodItemId: null,
        packagedProductId: null,
      },
    });

    await expect(
      service.updateFoodLog(userId, 'log-1', {
        amount: 80,
        amountUnit: 'G',
        portionKind: 'PACKAGE',
        portionMultiplier: 1,
      }),
    ).rejects.toMatchObject({
      response: { reason: 'PACKAGE_PORTION_UNAVAILABLE' },
    });
    expect(openFoodFacts.lookupByBarcode).not.toHaveBeenCalled();
    expect(prisma.foodLogEntry.update).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when updating an entry not owned by the user', async () => {
    const { service, prisma } = buildService();
    prisma.foodLogEntry.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.updateFoodLog(userId, 'log-1', { grams: 50 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('deletes an entry owned by the user', async () => {
    const { service, prisma } = buildService();

    await service.deleteFoodLog(userId, 'log-1');

    expect(prisma.foodLogEntry.delete).toHaveBeenCalledWith({
      where: { id: 'log-1' },
    });
  });

  it('throws NotFoundException when deleting an entry not owned by the user', async () => {
    const { service, prisma } = buildService();
    prisma.foodLogEntry.findFirst.mockResolvedValueOnce(null);

    await expect(service.deleteFoodLog(userId, 'log-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});
