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
      canonicalFood: {
        findUnique: jest.fn(),
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
    // Real BarcodeLookupCacheService behavior isn't under test here (see
    // barcode-lookup-cache.spec.ts) — a pass-through stub is enough so
    // FoodService's cache-through OFF lookup has something to call.
    const barcodeCache = { get: () => null, set: () => undefined };

    const service = new FoodService(
      prisma as never,
      openFoodFacts as never,
      usda as never,
      barcodeCache as never,
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

  // A canonical food's history entry defaults to the server-resolved English
  // name, but the search endpoint may have matched an Arabic query — the
  // client passes back whichever name the user actually saw. Regression
  // coverage for the 2026-09-14 review finding: a client-supplied name that
  // doesn't match the resolved record must NOT be trusted verbatim, since
  // that would decouple the displayed name from the nutrients actually
  // logged (e.g. sourceRef → chicken breast, name → "Ice cream").
  describe('CANONICAL source type', () => {
    function buildCanonicalService() {
      return buildService({
        prisma: {
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
        },
      });
    }

    it('defaults to the canonical English name when the client sends no name', async () => {
      const { service, created } = buildCanonicalService();

      await service.createFoodLog(userId, {
        sourceType: 'CANONICAL',
        sourceRef: 'canon-1',
        grams: 100,
        mealCategory: 'LUNCH',
        loggedAtUtc: '2026-08-30T12:00:00.000Z',
      });

      expect(created[0].name).toBe('Chicken breast, raw');
    });

    it('trusts a client-supplied name that matches the resolved Arabic name', async () => {
      const { service, created } = buildCanonicalService();

      await service.createFoodLog(userId, {
        sourceType: 'CANONICAL',
        sourceRef: 'canon-1',
        name: 'صدر فراخ نيء',
        grams: 100,
        mealCategory: 'LUNCH',
        loggedAtUtc: '2026-08-30T12:00:00.000Z',
      });

      expect(created[0].name).toBe('صدر فراخ نيء');
    });

    it('ignores a client-supplied name that does not match the resolved record', async () => {
      const { service, created } = buildCanonicalService();

      await service.createFoodLog(userId, {
        sourceType: 'CANONICAL',
        sourceRef: 'canon-1',
        name: 'Ice cream',
        grams: 100,
        mealCategory: 'LUNCH',
        loggedAtUtc: '2026-08-30T12:00:00.000Z',
      });

      expect(created[0].name).toBe('Chicken breast, raw');
    });
  });
});
