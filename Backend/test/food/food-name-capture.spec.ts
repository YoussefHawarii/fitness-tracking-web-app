import { FoodService } from '../../src/modules/food/food.service';

// FoodLogEntry.name is populated at log-creation time from whichever source
// resolved the nutrients (see specs/006-dashboard-history-greeting/research.md
// "Persist a `foodName` snapshot" decision) — verified here across all three
// source types rather than re-fetched at history-read time.
describe('FoodService — name capture on createFoodLog', () => {
  const userId = 'user-1';

  function buildService(
    overrides: {
      prisma?: Partial<Record<string, unknown>>;
      openFoodFacts?: Partial<Record<string, unknown>>;
      usda?: Partial<Record<string, unknown>>;
    } = {},
  ) {
    const created: Record<string, unknown>[] = [];
    const prisma = {
      foodLogEntry: {
        create: jest.fn((args: { data: Record<string, unknown> }) => {
          created.push(args.data);
          return Promise.resolve({ id: 'log-1', ...args.data });
        }),
      },
      localFoodItem: {
        findFirst: jest.fn(),
      },
      ...overrides.prisma,
    };
    const openFoodFacts = {
      lookupByBarcode: jest.fn(),
      ...overrides.openFoodFacts,
    };
    const usda = {
      searchByTerm: jest.fn(),
      getById: jest.fn(),
      ...overrides.usda,
    };

    const service = new FoodService(
      prisma as never,
      openFoodFacts as never,
      usda as never,
    );
    return { service, created };
  }

  it('captures the USDA match name', async () => {
    const { service, created } = buildService({
      usda: {
        getById: jest.fn().mockResolvedValue({
          fdcId: '123',
          name: 'Banana, raw',
          caloriesPer100g: 89,
        }),
      },
    });

    await service.createFoodLog(userId, {
      sourceType: 'USDA',
      sourceRef: '123',
      grams: 100,
      mealCategory: 'BREAKFAST',
      loggedAtUtc: '2026-08-30T08:00:00.000Z',
    });

    expect(created[0].name).toBe('Banana, raw');
  });

  it('captures the Open Food Facts product name', async () => {
    const { service, created } = buildService({
      openFoodFacts: {
        lookupByBarcode: jest
          .fn()
          .mockResolvedValue({ name: 'Cheerios', caloriesPer100g: 375 }),
      },
    });

    await service.createFoodLog(userId, {
      sourceType: 'OPEN_FOOD_FACTS',
      sourceRef: '0000000000000',
      grams: 40,
      mealCategory: 'BREAKFAST',
      loggedAtUtc: '2026-08-30T08:00:00.000Z',
    });

    expect(created[0].name).toBe('Cheerios');
  });

  it('captures the local food item name', async () => {
    const { service, created } = buildService({
      prisma: {
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
      },
    });

    await service.createFoodLog(userId, {
      sourceType: 'LOCAL',
      sourceRef: 'local-1',
      grams: 250,
      mealCategory: 'DINNER',
      loggedAtUtc: '2026-08-30T19:00:00.000Z',
    });

    expect(created[0].name).toBe("Mom's lasagna");
  });
});
