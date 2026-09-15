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

const canonicalRice = {
  id: 'cf-rice',
  nameEn: 'Rice, white, cooked',
  nameAr: 'أرز مطبوخ',
  aliasesEn: ['rice', 'white rice'],
  aliasesAr: ['رز'],
  caloriesPer100g: 130,
  proteinPer100g: 2.7,
  carbsPer100g: 28,
  fatPer100g: 0.3,
};

const canonicalEggs = {
  id: 'cf-eggs',
  nameEn: 'Eggs',
  nameAr: 'بيض',
  aliasesEn: ['eggs'],
  aliasesAr: ['بيض'],
  caloriesPer100g: 155,
  proteinPer100g: 13,
  carbsPer100g: 1.1,
  fatPer100g: 11,
};

const canonicalToast = {
  id: 'cf-toast',
  nameEn: 'Toast',
  nameAr: 'توست',
  aliasesEn: ['toast'],
  aliasesAr: ['توست'],
  caloriesPer100g: 313,
  proteinPer100g: 12,
  carbsPer100g: 55,
  fatPer100g: 4.3,
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

describe('FoodSearchService.searchTranscript', () => {
  it('does not substring-match filler spans against local item names', async () => {
    const { service } = buildService({
      localItems: [
        {
          id: 'local-chicken',
          name: 'Grilled chicken breast',
          caloriesPer100g: 165,
          proteinPer100g: 31,
          carbsPer100g: 0,
          fatPer100g: 3.6,
        },
      ],
    });

    const result = await service.searchTranscript('I had a sandwich', 'user-1');

    expect(result).toEqual({ groups: [] });
  });

  it('loads local items once and exact-matches them in memory across all spans', async () => {
    const { service, prisma } = buildService({
      localItems: [
        {
          id: 'local-lasagna',
          name: "Mom's lasagna",
          caloriesPer100g: 250,
          proteinPer100g: null,
          carbsPer100g: null,
          fatPer100g: null,
        },
      ],
    });

    const result = await service.searchTranscript(
      "yesterday I ate Mom's lasagna after training",
      'user-1',
    );

    expect(prisma.localFoodItem.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.localFoodItem.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].term).toBe('moms lasagna');
    expect(
      result.groups[0].result.type === 'single'
        ? result.groups[0].result.match.sourceRef
        : null,
    ).toBe('local-lasagna');
  });

  it('loads local items only once for a long transcript with no matches', async () => {
    const { service, prisma } = buildService();

    await service.searchTranscript(
      Array.from({ length: 50 }, (_, index) => `unknown${index}`).join(' '),
      'user-1',
    );

    expect(prisma.localFoodItem.findMany).toHaveBeenCalledTimes(1);
  });

  it('extracts two Arabic foods while ignoring filler before, between, and after them', async () => {
    const { service, usda } = buildService({
      canonicalFoods: [canonicalChickenBreast, canonicalRice],
    });

    const result = await service.searchTranscript(
      'أنا أكلت رز و فراخ النهارده',
      'user-1',
    );

    expect(result.groups).toHaveLength(2);
    expect(result.groups.map((group) => group.term)).toEqual(['رز', 'فراخ']);
    expect(
      result.groups.map((group) =>
        group.result.type === 'single' ? group.result.match.sourceRef : null,
      ),
    ).toEqual(['cf-rice', 'cf-1']);
    expect(usda.searchByTerm).not.toHaveBeenCalled();
  });

  it('recognizes an Arabic food when waw is attached to its first word', async () => {
    const { service } = buildService({ canonicalFoods: [canonicalRice] });

    const result = await service.searchTranscript('ورز', 'user-1');

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].term).toBe('رز');
    expect(
      result.groups[0].result.type === 'single'
        ? result.groups[0].result.match.sourceRef
        : null,
    ).toBe('cf-rice');
  });

  it('prefers a real waw-initial food match without stripping its waw', async () => {
    const vineLeaves = {
      ...canonicalRice,
      id: 'cf-vine-leaves',
      nameEn: 'Grape leaves, fresh',
      nameAr: 'ورق عنب',
      aliasesEn: ['grape leaves'],
      aliasesAr: ['ورق'],
    };
    const strippedDecoy = {
      ...canonicalRice,
      id: 'cf-stripped-decoy',
      nameEn: 'Synthetic stripped decoy',
      nameAr: 'رق',
      aliasesEn: [],
      aliasesAr: ['رق'],
    };
    const { service } = buildService({
      canonicalFoods: [vineLeaves, strippedDecoy],
    });

    const result = await service.searchTranscript('ورق', 'user-1');

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].term).toBe('ورق');
    expect(
      result.groups[0].result.type === 'single'
        ? result.groups[0].result.match.sourceRef
        : null,
    ).toBe('cf-vine-leaves');
  });

  it('extracts English foods separated by a comma without a following space', async () => {
    const { service } = buildService({
      canonicalFoods: [canonicalEggs, canonicalToast],
    });

    const result = await service.searchTranscript('eggs,toast', 'user-1');

    expect(result.groups.map((group) => group.term)).toEqual(['eggs', 'toast']);
  });

  it('extracts Arabic foods separated by an Arabic comma without a following space', async () => {
    const { service } = buildService({
      canonicalFoods: [canonicalRice, canonicalChickenBreast],
    });

    const result = await service.searchTranscript('رز،فراخ', 'user-1');

    expect(result.groups.map((group) => group.term)).toEqual(['رز', 'فراخ']);
  });

  it('uses longest-match-first so a multi-word alias is one group', async () => {
    const { service } = buildService({
      canonicalFoods: [canonicalChickenBreast],
    });

    const result = await service.searchTranscript(
      'I ate chicken breast today',
      'user-1',
    );

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].term).toBe('chicken breast');
  });

  it('recognizes a food when filler trails it', async () => {
    const { service } = buildService({
      canonicalFoods: [canonicalChickenBreast],
    });

    const result = await service.searchTranscript('فراخ النهارده', 'user-1');

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].term).toBe('فراخ');
  });

  it('keeps two multi-word dishes with different lengths in separate spans', async () => {
    const grilledChicken = {
      ...canonicalChickenBreast,
      id: 'cf-grilled-chicken',
      nameEn: 'Grilled chicken breast',
      aliasesEn: ['grilled chicken breast'],
      aliasesAr: [],
    };
    const { service } = buildService({
      canonicalFoods: [grilledChicken, canonicalRice],
    });

    const result = await service.searchTranscript(
      'yesterday grilled chicken breast with white rice',
      'user-1',
    );

    expect(result.groups.map((group) => group.term)).toEqual([
      'grilled chicken breast',
      'white rice',
    ]);
    expect(
      result.groups.map((group) =>
        group.result.type === 'single' ? group.result.match.sourceRef : null,
      ),
    ).toEqual(['cf-grilled-chicken', 'cf-rice']);
  });

  it('matches through embedded bidi and zero-width word boundaries', async () => {
    const { service } = buildService({
      canonicalFoods: [canonicalChickenBreast, canonicalRice],
    });

    const result = await service.searchTranscript(
      'أنا\u200Eأكلت رز\u200Bو فراخ',
      'user-1',
    );

    expect(result.groups.map((group) => group.term)).toEqual(['رز', 'فراخ']);
  });

  it('returns zero groups and never calls USDA when nothing is recognizable', async () => {
    const { service, usda } = buildService({
      canonicalFoods: [canonicalChickenBreast, canonicalRice],
    });

    const result = await service.searchTranscript(
      'nothing recognizable here',
      'user-1',
    );

    expect(result).toEqual({ groups: [] });
    expect(usda.searchByTerm).not.toHaveBeenCalled();
  });
});
