import { FoodService } from '../../src/modules/food/food.service';

describe('FoodService — food log amount contract', () => {
  const userId = 'user-1';

  function buildService(
    overrides: { existing?: Partial<Record<string, unknown>> } = {},
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
      amount: 100,
      amountUnit: 'G',
      portionKind: null,
      portionMultiplier: null,
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
        findFirst: jest.fn().mockResolvedValue({
          id: 'local-1',
          name: "Mom's lasagna",
          caloriesPer100g: 200,
          proteinPer100g: null,
          carbsPer100g: null,
          fatPer100g: null,
        }),
      },
      canonicalFood: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'canon-1',
          nameEn: 'Chicken breast, raw',
          nameAr: 'صدر فراخ نيء',
          caloriesPer100g: 120,
          proteinPer100g: 22.5,
          carbsPer100g: 0,
          fatPer100g: 2.6,
        }),
      },
    };
    const openFoodFacts = { lookupByBarcode: jest.fn() };
    const usda = {
      searchByTerm: jest.fn(),
      getById: jest.fn().mockResolvedValue({
        fdcId: '123',
        name: 'Banana, raw',
        caloriesPer100g: 89,
        proteinPer100g: 1,
        carbsPer100g: 23,
        fatPer100g: 0.3,
      }),
    };
    const barcodeCache = { get: () => null, set: () => undefined };
    const productResolver = { resolveBarcode: jest.fn() };
    const packagedProducts = {
      findById: jest.fn().mockResolvedValue({
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
      }),
    };

    const service = new FoodService(
      prisma as never,
      openFoodFacts as never,
      usda as never,
      barcodeCache as never,
      productResolver as never,
      packagedProducts as never,
    );
    return { service, created, updated };
  }

  const baseCreate = {
    amount: 150,
    amountUnit: 'G',
    mealCategory: 'LUNCH',
    loggedAtUtc: '2026-08-30T12:00:00.000Z',
  } as const;

  it.each([
    ['USDA', { sourceRef: '123' }],
    ['LOCAL', { sourceRef: 'local-1' }],
    ['CANONICAL', { sourceRef: 'canon-1' }],
    ['PACKAGED_PRODUCT', { sourceRef: 'product-1' }],
  ])(
    'creates an entry with amount and amountUnit (%s)',
    async (sourceType, extra) => {
      const { service, created } = buildService();

      await service.createFoodLog(userId, {
        sourceType: sourceType as 'USDA',
        ...extra,
        ...baseCreate,
      });

      expect(created[0].amount).toBe(150);
      expect(created[0].amountUnit).toBe('G');
      if (sourceType === 'LOCAL') expect(created[0].caloriesComputed).toBe(300);
    },
  );

  it('rejects a new Open Food Facts create', async () => {
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

  it('updates amount and amountUnit when the amount changes', async () => {
    const { service, updated } = buildService();

    await service.updateFoodLog(userId, 'log-1', {
      amount: 250,
      amountUnit: 'G',
    });

    expect(updated[0].amount).toBe(250);
    expect(updated[0].amountUnit).toBe('G');
    expect(updated[0].caloriesComputed).toBe(500);
  });

  it('changes only the meal on a meal-only update', async () => {
    const { service, updated } = buildService();

    await service.updateFoodLog(userId, 'log-1', { mealCategory: 'DINNER' });

    expect(updated[0]).toEqual({ mealCategory: 'DINNER' });
  });
});
