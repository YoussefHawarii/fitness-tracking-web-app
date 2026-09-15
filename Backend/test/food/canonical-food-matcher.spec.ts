import {
  containsArabic,
  matchCanonicalFoods,
  normalizeArabic,
  normalizeLatin,
  normalizeTerm,
  tokenizeFoodTranscript,
  type CanonicalFoodRecord,
} from '../../src/modules/food/canonical-food-matcher';

const chickenBreast: CanonicalFoodRecord = {
  id: 'chicken-breast',
  nameEn: 'Chicken breast, raw',
  nameAr: 'صدر فراخ نيء',
  aliasesEn: ['chicken breast', 'chicken'],
  aliasesAr: ['فراخ', 'دجاج'],
  caloriesPer100g: 120,
  proteinPer100g: 22.5,
  carbsPer100g: 0,
  fatPer100g: 2.6,
};

const chickenThigh: CanonicalFoodRecord = {
  id: 'chicken-thigh',
  nameEn: 'Chicken thigh, raw',
  nameAr: 'فخذ فراخ نيء',
  aliasesEn: ['chicken thigh', 'chicken'],
  aliasesAr: ['فخذ فراخ', 'دجاج'],
  caloriesPer100g: 177,
  proteinPer100g: 19,
  carbsPer100g: 0,
  fatPer100g: 10.9,
};

const rice: CanonicalFoodRecord = {
  id: 'rice-cooked',
  nameEn: 'Rice, white, cooked',
  nameAr: 'أرز مطبوخ',
  aliasesEn: ['rice'],
  aliasesAr: ['رز'],
  caloriesPer100g: 130,
  proteinPer100g: 2.7,
  carbsPer100g: 28,
  fatPer100g: 0.3,
};

describe('canonical-food-matcher normalization', () => {
  it('detects Arabic script', () => {
    expect(containsArabic('فراخ')).toBe(true);
    expect(containsArabic('chicken')).toBe(false);
  });

  it('strips tashkeel (diacritics) and tatweel', () => {
    expect(normalizeArabic('فَرَاخّ')).toBe(normalizeArabic('فراخ'));
    expect(normalizeArabic('فـــراخ')).toBe(normalizeArabic('فراخ'));
  });

  it('folds alef, ya, and ta-marbuta spelling variants', () => {
    // إ / أ / آ / ا all fold to ا; ى folds to ي; ة folds to ه
    expect(normalizeArabic('أرز')).toBe(normalizeArabic('ارز'));
    expect(normalizeArabic('إرز')).toBe(normalizeArabic('ارز'));
    expect(normalizeArabic('مطبوخة')).toBe(normalizeArabic('مطبوخه'));
  });

  it('drops the definite article "ال" so "the chicken" matches "chicken"', () => {
    // Very common in natural Egyptian speech ("الفراخ" = "the chicken").
    expect(normalizeArabic('الفراخ')).toBe(normalizeArabic('فراخ'));
    expect(normalizeArabic('صدر الدجاج')).toBe(normalizeArabic('صدر دجاج'));
  });

  it('strips stray punctuation, mirroring normalizeLatin', () => {
    expect(normalizeArabic('فراخ؟')).toBe(normalizeArabic('فراخ'));
    expect(normalizeArabic('فراخ!')).toBe(normalizeArabic('فراخ'));
  });

  it('lowercases and strips punctuation for Latin text', () => {
    expect(normalizeLatin('Chicken-Breast!')).toBe('chickenbreast');
    expect(normalizeLatin('  Rice   ')).toBe('rice');
  });

  it('treats bidi, zero-width, joiner, and non-breaking characters as word boundaries', () => {
    expect(
      tokenizeFoodTranscript(
        'I\u200Ehad\u200Fchicken\u200Bbreast\u200Crice\u200Dtoast\u00A0today',
      ),
    ).toEqual(['i', 'had', 'chicken', 'breast', 'rice', 'toast', 'today']);
  });

  it('treats English and Arabic commas as word boundaries without surrounding spaces', () => {
    expect(tokenizeFoodTranscript('eggs,toast')).toEqual(['eggs', 'toast']);
    expect(tokenizeFoodTranscript('رز،فراخ')).toEqual(['رز', 'فراخ']);
  });

  it('routes normalization by detected script', () => {
    expect(normalizeTerm('Chicken')).toBe(normalizeLatin('Chicken'));
    expect(normalizeTerm('فراخ')).toBe(normalizeArabic('فراخ'));
  });

  it('returns empty string for a term that normalizes to nothing', () => {
    expect(normalizeTerm('   ')).toBe('');
  });
});

describe('matchCanonicalFoods', () => {
  const catalog = [chickenBreast, chickenThigh, rice];

  it('finds an exact English name match', () => {
    const results = matchCanonicalFoods('chicken breast', catalog);
    expect(results).toHaveLength(1);
    expect(results[0].food.id).toBe('chicken-breast');
    expect(results[0].exact).toBe(true);
  });

  it('finds an exact Arabic alias match, case/diacritic-insensitive', () => {
    const results = matchCanonicalFoods('فَرَاخ', catalog);
    expect(results.map((r) => r.food.id)).toContain('chicken-breast');
    expect(results[0].exact).toBe(true);
  });

  it('displays the name in the query script (Arabic in, Arabic name out)', () => {
    const results = matchCanonicalFoods('رز', catalog);
    expect(results[0].displayName).toBe(rice.nameAr);
  });

  it('displays the English name for an English query', () => {
    const results = matchCanonicalFoods('rice', catalog);
    expect(results[0].displayName).toBe(rice.nameEn);
  });

  it('is genuinely ambiguous when an alias is shared by multiple foods', () => {
    // "دجاج" is listed as an alias on both chicken breast and chicken thigh —
    // this must NOT resolve to a single confident match.
    const results = matchCanonicalFoods('دجاج', catalog);
    const ids = results.map((r) => r.food.id).sort();
    expect(ids).toEqual(['chicken-breast', 'chicken-thigh']);
    expect(results.every((r) => r.exact)).toBe(true);
  });

  it('returns a substring match for a partial term without an exact hit', () => {
    const results = matchCanonicalFoods('chick', catalog);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.exact === false)).toBe(true);
  });

  it('returns no matches for an unrelated term', () => {
    expect(matchCanonicalFoods('spaceship', catalog)).toEqual([]);
  });

  it('surfaces all preparations of a food, not just the first one added (potato: boiled/fries/pan-fried)', () => {
    // Real user feedback: searching "بطاطس" only showed boiled potatoes
    // because the other preparations didn't exist in the catalog yet at
    // all — see Backend/prisma/seed.ts. Once added, a bare query must
    // surface all three rather than just the first alphabetically/insertion
    // order, since boiled (87 kcal) vs. fries (289 kcal) is over 3x apart.
    const boiled: CanonicalFoodRecord = {
      id: 'potato-boiled',
      nameEn: 'Potato, boiled',
      nameAr: 'بطاطس مسلوقة',
      aliasesEn: ['potato', 'boiled potato', 'potatoes'],
      aliasesAr: ['بطاطا', 'بطاطس'],
      caloriesPer100g: 87,
      proteinPer100g: 1.9,
      carbsPer100g: 20,
      fatPer100g: 0.1,
    };
    const fries: CanonicalFoodRecord = {
      id: 'potato-fries',
      nameEn: 'Potato, French fries',
      nameAr: 'بطاطس بوري',
      aliasesEn: ['french fries', 'fries', 'potato', 'potatoes'],
      aliasesAr: ['بوري', 'بطاطس', 'بطاطا'],
      caloriesPer100g: 289,
      proteinPer100g: 3.5,
      carbsPer100g: 37,
      fatPer100g: 14,
    };
    const panFried: CanonicalFoodRecord = {
      id: 'potato-pan-fried',
      nameEn: 'Potato, pan-fried',
      nameAr: 'بطاطس محمرة',
      aliasesEn: ['fried potato', 'potato', 'potatoes'],
      aliasesAr: ['محمرة', 'بطاطس', 'بطاطا'],
      caloriesPer100g: 197,
      proteinPer100g: 1.9,
      carbsPer100g: 18,
      fatPer100g: 13,
    };
    const potatoCatalog = [boiled, fries, panFried];

    const englishResults = matchCanonicalFoods('potato', potatoCatalog);
    expect(englishResults.map((r) => r.food.id).sort()).toEqual([
      'potato-boiled',
      'potato-fries',
      'potato-pan-fried',
    ]);

    const arabicResults = matchCanonicalFoods('بطاطس', potatoCatalog);
    expect(arabicResults.map((r) => r.food.id).sort()).toEqual([
      'potato-boiled',
      'potato-fries',
      'potato-pan-fried',
    ]);
  });

  it('treats raw vs. cooked as genuine ambiguity, not a single silent pick', () => {
    // Mirrors the real seed data (Backend/prisma/seed.ts): raw and cooked
    // chicken breast share the generic "chicken breast" alias, since a bare
    // query doesn't specify preparation and the calorie difference (120 vs
    // 165/100g) is too significant to silently guess — see
    // docs/food-log-input-modes-diagnosis.md §3.4 item 3.
    const rawChicken: CanonicalFoodRecord = {
      id: 'chicken-raw',
      nameEn: 'Chicken breast, raw',
      nameAr: 'صدر فراخ نيء',
      aliasesEn: ['chicken breast', 'chicken', 'raw chicken breast'],
      aliasesAr: ['فراخ', 'صدر دجاج'],
      caloriesPer100g: 120,
      proteinPer100g: 22.5,
      carbsPer100g: 0,
      fatPer100g: 2.6,
    };
    const cookedChicken: CanonicalFoodRecord = {
      id: 'chicken-cooked',
      nameEn: 'Chicken breast, cooked',
      nameAr: 'صدر فراخ مشوي',
      aliasesEn: ['grilled chicken breast', 'chicken breast', 'chicken'],
      aliasesAr: ['فراخ مشوية', 'فراخ'],
      caloriesPer100g: 165,
      proteinPer100g: 31,
      carbsPer100g: 0,
      fatPer100g: 3.6,
    };
    const catalogWithPrep = [rawChicken, cookedChicken];

    const generic = matchCanonicalFoods('chicken breast', catalogWithPrep);
    expect(generic.map((r) => r.food.id).sort()).toEqual([
      'chicken-cooked',
      'chicken-raw',
    ]);
    expect(generic.every((r) => r.exact)).toBe(true);

    // A qualified query still resolves to exactly one.
    const qualified = matchCanonicalFoods(
      'grilled chicken breast',
      catalogWithPrep,
    );
    expect(qualified).toHaveLength(1);
    expect(qualified[0].food.id).toBe('chicken-cooked');
  });

  it('ranks exact matches before substring matches', () => {
    const withDecoy: CanonicalFoodRecord[] = [
      {
        ...rice,
        id: 'rice-decoy',
        nameEn: 'Rice pudding',
        aliasesEn: [],
      },
      rice,
    ];
    const results = matchCanonicalFoods('rice', withDecoy);
    expect(results[0].food.id).toBe('rice-cooked');
    expect(results[0].exact).toBe(true);
  });
});
