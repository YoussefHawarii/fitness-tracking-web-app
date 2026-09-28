import { FoodService } from '../../src/modules/food/food.service';

// specs/009-barcode-portion-logging ticket 01 (expand step): every
// FoodLogEntry write dual-writes amount = grams with amountUnit G, and the
// update path reads the existing quantity as amount ?? grams. No visible
// behaviour change — nutrition arithmetic is untouched.
describe('FoodService — food log dual-write (amount/amountUnit)', () => {
  const userId = 'user-1';

  function buildService(
    overrides: {
      existing?: Partial<Record<string, unknown>>;
      localItem?: Partial<Record<string, unknown>> | null;
      canonicalFood?: Partial<Record<string, unknown>> | null;
      openFoodFactsProduct?: Partial<Record<string, unknown>> | null;
      packagedProduct?: Partial<Record<string, unknown>> | null;
      usdaMatch?: Partial<Record<string, unknown>> | null;
    } = {},
  ) {
    const created: Record<string, unknown>[] = [];
    const updated: Record<string, unknown>[] = [];
    const existing = {
      id: 'log-1',
      userId,
      sourceType: 'LOCAL',
      sourceRef: 'local-1',
      name: "Mom's lasagna",
      localFoodItemId: 'local-1',
      grams: 100,
      amount: null as unknown,
      amountUnit: null as unknown,
      mealCategory: 'LUNCH',
      ...overrides.existing,
    };
    const prisma = {
      foodLogEntry: {
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn((args: { data: Record<string, unknown> }) => {
          created.push(args.data);
          return Promise.resolve({ id: 'log-1', ...args.data });
        }),
        update: jest.fn((args: { data: Record<string, unknown> }) => {
          updated.push(args.data);
          return Promise.resolve({ ...existing, ...args.data });
        }),
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
      canonicalFood: {
        findUnique: jest.fn().mockResolvedValue(
          overrides.canonicalFood === null
            ? null
            : {
                id: 'canon-1',
                nameEn: 'Chicken breast, raw',
                nameAr: 'صدر فراخ نيء',
                caloriesPer100g: 120,
                proteinPer100g: 22.5,
                carbsPer100g: 0,
                fatPer100g: 2.6,
                ...overrides.canonicalFood,
              },
        ),
      },
    };
    const openFoodFacts = {
      lookupByBarcode: jest.fn().mockResolvedValue(
        overrides.openFoodFactsProduct === null
          ? null
          : {
              name: 'Legacy barcode product',
              caloriesPer100g: 250,
              proteinPer100g: 5,
              carbsPer100g: 30,
              fatPer100g: 10,
              ...overrides.openFoodFactsProduct,
            },
      ),
    };
    const usda = {
      searchByTerm: jest.fn(),
      getById: jest.fn().mockResolvedValue(
        overrides.usdaMatch === null
          ? null
          : {
              fdcId: '123',
              name: 'Banana, raw',
              caloriesPer100g: 89,
              proteinPer100g: 1,
              carbsPer100g: 23,
              fatPer100g: 0.3,
              ...overrides.usdaMatch,
            },
      ),
    };
    const barcodeCache = { get: () => null, set: () => undefined };
    const productResolver = { resolveBarcode: jest.fn() };
    const packagedProducts = {
      findById: jest.fn().mockResolvedValue(
        overrides.packagedProduct === null
          ? null
          : {
              id: 'product-1',
              name: 'Chipsy Salt & Vinegar',
              brand: null,
              imageUrl: null,
              source: 'OPEN_FOOD_FACTS',
              packageSize: 150,
              packageBaseUnit: 'G',
              servingSize: null,
              servingBaseUnit: null,
              containerKey: 'PACKAGE',
              declaredNutritionBasis: null,
              caloriesPer100g: 536,
              proteinPer100g: 6.5,
              carbsPer100g: 53,
              fatPer100g: 33,
              ...overrides.packagedProduct,
            },
      ),
    };

    const service = new FoodService(
      prisma as never,
      openFoodFacts as never,
      usda as never,
      barcodeCache as never,
      productResolver as never,
      packagedProducts as never,
    );
    return { service, prisma, created, updated };
  }

  const baseCreate = {
    grams: 150,
    mealCategory: 'LUNCH',
    loggedAtUtc: '2026-08-30T12:00:00.000Z',
  } as const;

  it.each([
    ['USDA', { sourceRef: '123' }],
    ['LOCAL', { sourceRef: 'local-1' }],
    ['CANONICAL', { sourceRef: 'canon-1' }],
    ['PACKAGED_PRODUCT', { sourceRef: 'product-1' }],
  ])(
    'create dual-writes amount = grams with amountUnit G (%s)',
    async (sourceType, extra) => {
      const { service, created } = buildService();

      await service.createFoodLog(userId, {
        sourceType: sourceType as 'USDA',
        ...extra,
        ...baseCreate,
      });

      expect(created[0].grams).toBe(150);
      expect(created[0].amount).toBe(150);
      expect(created[0].amountUnit).toBe('G');
      // Nutrition arithmetic unchanged: 200 cal/100g (LOCAL) etc. still scale
      // from grams as before — spot-check the LOCAL path's calories here.
      if (sourceType === 'LOCAL') {
        expect(created[0].caloriesComputed).toBe(300);
      }
    },
  );

  it('rejects a new legacy Open Food Facts create', async () => {
    const { service, created } = buildService();

    await expect(
      service.createFoodLog(userId, {
        sourceType: 'OPEN_FOOD_FACTS',
        sourceRef: '3017620422003',
        ...baseCreate,
      }),
    ).rejects.toMatchObject({
      response: { reason: 'OPEN_FOOD_FACTS_CREATE_RETIRED' },
    });
    expect(created).toHaveLength(0);
  });

  it('update dual-writes amount and grams equal when the amount changes', async () => {
    const { service, updated } = buildService({
      existing: { grams: 100, amount: 100, amountUnit: 'G' },
    });

    await service.updateFoodLog(userId, 'log-1', { grams: 250 });

    expect(updated[0].grams).toBe(250);
    expect(updated[0].amount).toBe(250);
    expect(updated[0].amountUnit).toBe('G');
    // 200 cal/100g * 250g = 500 — recalculation still from the new quantity.
    expect(updated[0].caloriesComputed).toBe(500);
  });

  it('a meal-only update on a row with amount null changes no stored quantity', async () => {
    const { service, updated } = buildService({
      existing: { grams: 100, amount: null, amountUnit: null },
    });

    await service.updateFoodLog(userId, 'log-1', { mealCategory: 'DINNER' });

    expect(updated[0]).toEqual({ mealCategory: 'DINNER' });
  });

  it('a meal-only update on a dual-written row keeps the quantity', async () => {
    const { service, updated } = buildService({
      existing: { grams: 150, amount: 150, amountUnit: 'G' },
    });

    await service.updateFoodLog(userId, 'log-1', { mealCategory: 'SNACKS' });

    expect(updated[0]).toEqual({ mealCategory: 'SNACKS' });
  });

  it('a meal-only update does not normalize mismatched Decimal quantities', async () => {
    const { service, updated } = buildService({
      existing: {
        grams: 100,
        amount: 150.5,
        amountUnit: 'G',
      },
    });

    await service.updateFoodLog(userId, 'log-1', { mealCategory: 'DINNER' });

    expect(updated[0]).toEqual({ mealCategory: 'DINNER' });
  });

  it('a meal-only update with null grams preserves the stored Decimal amount', async () => {
    const { service, updated } = buildService({
      existing: {
        grams: null,
        amount: 80,
        amountUnit: 'G',
      },
    });

    await service.updateFoodLog(userId, 'log-1', { mealCategory: 'DINNER' });

    expect(updated[0]).toEqual({ mealCategory: 'DINNER' });
  });
});
