import { FoodSearchService } from '../../src/modules/food/food-search.service';

function buildService(
  overrides: {
    canonicalFoods?: unknown[];
    localItems?: unknown[];
    usdaResults?: unknown[];
  } = {},
) {
  const prisma = {
    canonicalFood: {
      findMany: jest.fn(() => Promise.resolve(overrides.canonicalFoods ?? [])),
    },
    localFoodItem: {
      findMany: jest.fn(() => Promise.resolve(overrides.localItems ?? [])),
    },
  };
  const usda = {
    searchByTerm: jest.fn(() => Promise.resolve(overrides.usdaResults ?? [])),
  };

  const service = new FoodSearchService(
    prisma as unknown as ConstructorParameters<typeof FoodSearchService>[0],
    usda as unknown as ConstructorParameters<typeof FoodSearchService>[1],
  );

  return { service, prisma, usda };
}

const canonicalChickenBreast = {
  id: 'cf-1',
  nameEn: 'Chicken breast, raw',
  nameAr: 'صدر فراخ نيء',
  aliasesEn: ['chicken breast', 'chicken'],
  aliasesAr: ['فراخ'],
  caloriesPer100g: 120,
  proteinPer100g: 22.5,
  carbsPer100g: 0,
  fatPer100g: 2.6,
};

describe('FoodSearchService.search', () => {
  it('returns a single canonical match for an exact English term', async () => {
    const { service } = buildService({
      canonicalFoods: [canonicalChickenBreast],
    });

    const result = await service.search('chicken breast', 'user-1');

    expect(result.type).toBe('single');
    if (result.type === 'single') {
      expect(result.match.sourceType).toBe('CANONICAL');
      expect(result.match.sourceRef).toBe('cf-1');
      expect(result.match.name).toBe('Chicken breast, raw');
      expect(result.match.caloriesPer100g).toBe(120);
    }
  });

  it('returns a single canonical match for an Arabic alias, with the Arabic name displayed', async () => {
    const { service } = buildService({
      canonicalFoods: [canonicalChickenBreast],
    });

    const result = await service.search('فراخ', 'user-1');

    expect(result.type).toBe('single');
    if (result.type === 'single') {
      expect(result.match.name).toBe('صدر فراخ نيء');
    }
  });

  it('never reaches USDA when the canonical catalog already resolves the term', async () => {
    const { service, usda } = buildService({
      canonicalFoods: [canonicalChickenBreast],
    });

    await service.search('chicken breast', 'user-1');

    expect(usda.searchByTerm).not.toHaveBeenCalled();
  });

  it("falls back to the user's own LocalFoodItems when nothing canonical matches", async () => {
    const { service, usda } = buildService({
      canonicalFoods: [canonicalChickenBreast],
      localItems: [
        {
          id: 'local-1',
          name: "Mom's lasagna",
          caloriesPer100g: 250,
          proteinPer100g: null,
          carbsPer100g: null,
          fatPer100g: null,
        },
      ],
    });

    const result = await service.search('lasagna', 'user-1');

    expect(result.type).toBe('single');
    if (result.type === 'single') {
      expect(result.match.sourceType).toBe('LOCAL');
      expect(result.match.sourceRef).toBe('local-1');
    }
    expect(usda.searchByTerm).not.toHaveBeenCalled();
  });

  it('falls back to USDA only when neither the catalog nor local items match', async () => {
    const { service, usda } = buildService({
      canonicalFoods: [canonicalChickenBreast],
      usdaResults: [
        {
          fdcId: '12345',
          name: 'Quinoa, cooked',
          caloriesPer100g: 120,
          proteinPer100g: 4.4,
          carbsPer100g: 21.3,
          fatPer100g: 1.9,
        },
      ],
    });

    const result = await service.search('quinoa', 'user-1');

    expect(usda.searchByTerm).toHaveBeenCalledWith('quinoa');
    expect(result.type).toBe('candidates');
    if (result.type === 'candidates') {
      expect(result.matches[0].sourceType).toBe('USDA');
      expect(result.matches[0].sourceRef).toBe('12345');
    }
  });

  it('finds a canonical match after stripping a leading filler word ("I had chicken breast")', async () => {
    const { service, usda } = buildService({
      canonicalFoods: [canonicalChickenBreast],
    });

    const result = await service.search('I had chicken breast', 'user-1');

    expect(result.type).toBe('single');
    if (result.type === 'single') {
      expect(result.match.sourceRef).toBe('cf-1');
    }
    expect(usda.searchByTerm).not.toHaveBeenCalled();
  });

  it('finds a canonical match after stripping a leading Arabic verb ("أكلت فراخ")', async () => {
    const { service } = buildService({
      canonicalFoods: [canonicalChickenBreast],
    });

    const result = await service.search('أكلت فراخ', 'user-1');

    expect(result.type).toBe('single');
    if (result.type === 'single') {
      expect(result.match.sourceRef).toBe('cf-1');
    }
  });

  it('gives up after the leading-word-strip cap instead of stripping indefinitely', async () => {
    const { service, usda } = buildService({
      canonicalFoods: [canonicalChickenBreast],
      usdaResults: [],
    });

    // Three filler words before the food name exceeds the strip cap (2).
    const result = await service.search(
      'so I then had chicken breast',
      'user-1',
    );

    expect(result).toEqual({ type: 'empty' });
    expect(usda.searchByTerm).toHaveBeenCalled();
  });

  it('returns "empty" when nothing matches anywhere, including USDA', async () => {
    const { service } = buildService({ usdaResults: [] });

    const result = await service.search('zzznonexistentfood', 'user-1');

    expect(result).toEqual({ type: 'empty' });
  });

  it('returns "empty" for a blank/whitespace-only term without querying anything', async () => {
    const { service, prisma, usda } = buildService();

    const result = await service.search('   ', 'user-1');

    expect(result).toEqual({ type: 'empty' });
    expect(prisma.canonicalFood.findMany).not.toHaveBeenCalled();
    expect(usda.searchByTerm).not.toHaveBeenCalled();
  });

  it('returns candidates (not a false single) when a canonical alias is shared by multiple foods', async () => {
    const thigh = {
      id: 'cf-2',
      nameEn: 'Chicken thigh, raw',
      nameAr: 'فخذ فراخ نيء',
      aliasesEn: ['chicken'],
      aliasesAr: ['فراخ'],
      caloriesPer100g: 177,
      proteinPer100g: 19,
      carbsPer100g: 0,
      fatPer100g: 10.9,
    };
    const { service } = buildService({
      canonicalFoods: [canonicalChickenBreast, thigh],
    });

    const result = await service.search('فراخ', 'user-1');

    expect(result.type).toBe('candidates');
    if (result.type === 'candidates') {
      expect(result.matches.map((m) => m.sourceRef).sort()).toEqual([
        'cf-1',
        'cf-2',
      ]);
    }
  });
});
