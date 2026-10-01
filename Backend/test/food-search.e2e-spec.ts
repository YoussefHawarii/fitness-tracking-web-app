import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/modules/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { UsdaClient } from '../src/modules/food/clients/usda.client';
import { OpenFoodFactsClient } from '../src/modules/food/clients/open-food-facts.client';
import { globalValidationPipe } from '../src/common/pipes/validation.pipe';
import {
  NutritionBasis,
  ProductSource,
  VerificationStatus,
} from '@prisma/client';
import {
  importPackagedProducts,
  parsePackagedProductRecords,
} from '../prisma/import-packaged-products';

interface FoodMatchBody {
  sourceType: string;
  sourceRef: string;
  name: string;
  caloriesPer100g: number;
}
type FoodSearchResponseBody =
  | { type: 'single'; match: FoodMatchBody }
  | { type: 'candidates'; matches: FoodMatchBody[] }
  | { type: 'empty' };

interface TranscriptSearchResponseBody {
  groups: Array<{
    term: string;
    result: Exclude<FoodSearchResponseBody, { type: 'empty' }>;
  }>;
}

// barcode-normalizer.ts now validates the GS1 check digit, so a synthetic
// test barcode must carry a real one — this appends the correct 13th digit
// to an arbitrary 12-digit prefix (per the same alternating 3/1 weighting).
function ean13WithValidCheckDigit(twelveDigitPrefix: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const weight = i % 2 === 1 ? 3 : 1;
    sum += Number(twelveDigitPrefix[i]) * weight;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return `${twelveDigitPrefix}${checkDigit}`;
}

// Covers docs/food-log-input-modes-diagnosis.md §3.4 (GET /food/search:
// canonical -> local -> USDA fallback) and §1.6 item 4 (barcode lookup
// reused between scan and save instead of re-fetched from Open Food Facts).
describe('Food search + barcode reuse (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sentOtpEmails: { to: string; code: string }[] = [];
  const usdaSearchByTerm = jest.fn(() => Promise.resolve<unknown[]>([]));
  const offLookupByBarcode = jest.fn(() => Promise.resolve<unknown>(null));

  const testSuffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const createdCanonicalFoodIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MailService)
      .useValue({
        sendOtpEmail: (to: string, code: string) => {
          sentOtpEmails.push({ to, code });
          return Promise.resolve();
        },
        sendWelcomeEmail: () => Promise.resolve(),
      })
      .overrideProvider(UsdaClient)
      .useValue({ searchByTerm: usdaSearchByTerm, getById: jest.fn() })
      .overrideProvider(OpenFoodFactsClient)
      .useValue({ lookupByBarcode: offLookupByBarcode })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(globalValidationPipe);
    await app.init();
    prisma = moduleFixture.get(PrismaService);

    const chickenBreast = await prisma.canonicalFood.create({
      data: {
        nameEn: `Test Chicken Breast ${testSuffix}`,
        nameAr: `صدر فراخ اختبار ${testSuffix}`,
        aliasesEn: [`testchicken${testSuffix}`],
        aliasesAr: [],
        caloriesPer100g: 120,
        proteinPer100g: 22.5,
        carbsPer100g: 0,
        fatPer100g: 2.6,
      },
    });
    const chickenThigh = await prisma.canonicalFood.create({
      data: {
        nameEn: `Test Chicken Thigh ${testSuffix}`,
        nameAr: `فخذ فراخ اختبار ${testSuffix}`,
        aliasesEn: [`sharedalias${testSuffix}`],
        aliasesAr: [],
        caloriesPer100g: 177,
        proteinPer100g: 19,
        carbsPer100g: 0,
        fatPer100g: 10.9,
      },
    });
    const chickenWing = await prisma.canonicalFood.create({
      data: {
        nameEn: `Test Chicken Wing ${testSuffix}`,
        nameAr: `جناح فراخ اختبار ${testSuffix}`,
        aliasesEn: [`sharedalias${testSuffix}`],
        aliasesAr: [],
        caloriesPer100g: 203,
        proteinPer100g: 18,
        carbsPer100g: 0,
        fatPer100g: 13,
      },
    });
    createdCanonicalFoodIds.push(
      chickenBreast.id,
      chickenThigh.id,
      chickenWing.id,
    );
  });

  afterAll(async () => {
    await prisma.canonicalFood.deleteMany({
      where: { id: { in: createdCanonicalFoodIds } },
    });
    await app.close();
  });

  beforeEach(() => {
    usdaSearchByTerm.mockClear();
    offLookupByBarcode.mockClear();
  });

  async function newVerifiedUser(tag: string) {
    const email = `foodsearch-${tag}-${testSuffix}-${Math.floor(Math.random() * 1000)}@example.com`;
    // SignupDto's username is capped at 30 chars and alphanumeric/underscore
    // only (Backend/src/modules/auth/dto/signup.dto.ts) — a longer/hyphenated
    // `tag` embedded directly (e.g. "usda-fallback") can violate both, so
    // uniqueness comes from a short random token instead of the tag itself.
    const username = `u${Math.random().toString(36).slice(2, 10)}${Math.floor(Math.random() * 1000)}`;
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        username,
        email,
        password: 'CorrectHorse123',
        timezone: 'UTC',
      })
      .expect(201);
    const sent = sentOtpEmails.filter((e) => e.to === email).pop();
    if (!sent) throw new Error(`No OTP email captured for ${email}`);
    const verifyRes = await request(app.getHttpServer())
      .post('/auth/verify-otp')
      .send({ email, code: sent.code })
      .expect(201);
    return (verifyRes.body as { accessToken: string }).accessToken;
  }

  it('resolves an exact term to a single canonical match without touching USDA', async () => {
    const token = await newVerifiedUser('single');

    const res = await request(app.getHttpServer())
      .get('/food/search')
      .query({ term: `Test Chicken Breast ${testSuffix}` })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as FoodSearchResponseBody;
    expect(body.type).toBe('single');
    if (body.type === 'single') {
      expect(body.match.sourceType).toBe('CANONICAL');
      expect(body.match.caloriesPer100g).toBe(120);
    }
    expect(usdaSearchByTerm).not.toHaveBeenCalled();
  });

  it('extracts a seeded canonical food from an authenticated transcript request', async () => {
    const token = await newVerifiedUser('transcript');

    const res = await request(app.getHttpServer())
      .get('/food/search-transcript')
      .query({ transcript: `I ate testchicken${testSuffix} today` })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as TranscriptSearchResponseBody;
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0].term).toBe(`testchicken${testSuffix}`);
    expect(body.groups[0].result.type).toBe('single');
    if (body.groups[0].result.type === 'single') {
      expect(body.groups[0].result.match.sourceType).toBe('CANONICAL');
      expect(body.groups[0].result.match.sourceRef).toBe(
        createdCanonicalFoodIds[0],
      );
      expect(body.groups[0].result.match.caloriesPer100g).toBe(120);
    }
    expect(usdaSearchByTerm).not.toHaveBeenCalled();
  });

  it('returns candidates when a canonical alias is shared by multiple foods', async () => {
    const token = await newVerifiedUser('candidates');

    const res = await request(app.getHttpServer())
      .get('/food/search')
      .query({ term: `sharedalias${testSuffix}` })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as FoodSearchResponseBody;
    expect(body.type).toBe('candidates');
    if (body.type === 'candidates') {
      expect(body.matches).toHaveLength(2);
      expect(body.matches.every((m) => m.sourceType === 'CANONICAL')).toBe(
        true,
      );
    }
  });

  it('falls back to USDA (mocked) when nothing canonical or local matches', async () => {
    usdaSearchByTerm.mockResolvedValueOnce([
      {
        fdcId: '999999',
        name: 'Quinoa, cooked',
        caloriesPer100g: 120,
        proteinPer100g: 4.4,
        carbsPer100g: 21.3,
        fatPer100g: 1.9,
      },
    ]);
    const token = await newVerifiedUser('usda-fallback');

    const res = await request(app.getHttpServer())
      .get('/food/search')
      .query({ term: `no-canonical-match-${testSuffix}` })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(usdaSearchByTerm).toHaveBeenCalledWith(
      `no-canonical-match-${testSuffix}`,
    );
    const body = res.body as FoodSearchResponseBody;
    expect(body.type).toBe('candidates');
    if (body.type === 'candidates') {
      expect(body.matches[0].sourceType).toBe('USDA');
      expect(body.matches[0].sourceRef).toBe('999999');
    }
  });

  it('returns "empty" when nothing matches anywhere', async () => {
    const token = await newVerifiedUser('empty');

    const res = await request(app.getHttpServer())
      .get('/food/search')
      .query({ term: `definitely-nothing-${testSuffix}` })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual({ type: 'empty' });
  });

  it('caches a barcode locally on first Open Food Facts hit, then serves later lookups and logging from the local DB', async () => {
    // Valid 13-digit EAN-13 (real check digit) so it survives barcode
    // normalization — the numeric suffix keeps it unique per test run.
    const barcode = ean13WithValidCheckDigit(
      `500000${testSuffix}`.padEnd(12, '1').slice(0, 12),
    );
    offLookupByBarcode.mockResolvedValueOnce({
      outcome: 'FOUND_WITH_NUTRITION',
      barcode,
      name: 'Test Product',
      nameAr: 'منتج اختبار',
      brand: 'Test Brand',
      imageUrl: 'https://images.example/test-product.jpg',
      packageSize: 150,
      packageUnit: 'g',
      caloriesPer100g: 250,
      proteinPer100g: 5,
      carbsPer100g: 30,
      fatPer100g: 10,
    });
    const token = await newVerifiedUser('barcode-cache');

    // First scan: local DB miss -> Open Food Facts hit -> persisted locally.
    const first = await request(app.getHttpServer())
      .get(`/food/barcode/${barcode}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(offLookupByBarcode).toHaveBeenCalledTimes(1);
    const firstBody = first.body as {
      id: string;
      name: string;
      nameAr: string;
      brand: string;
      imageUrl: string;
      packageSize: number;
      packageBaseUnit: string;
      caloriesPer100g: number;
      proteinPer100g: number;
      carbsPer100g: number;
      fatPer100g: number;
      verificationStatus: string;
      resolution: {
        outcome: string;
        portionDimension: string;
        effectiveNutritionBasis: {
          basis: string;
          origin: string;
          source: string;
          ruleId: string;
        };
        package: { size: number; baseUnit: string };
        serving: null;
        containerKey: string;
      };
    };
    const productId = firstBody.id;
    expect(firstBody).toMatchObject({
      name: 'Test Product',
      nameAr: 'منتج اختبار',
      brand: 'Test Brand',
      imageUrl: 'https://images.example/test-product.jpg',
      packageSize: 150,
      packageBaseUnit: 'G',
      caloriesPer100g: 250,
      proteinPer100g: 5,
      carbsPer100g: 30,
      fatPer100g: 10,
      verificationStatus: 'EXTERNAL',
      resolution: {
        outcome: 'LOGGABLE',
        portionDimension: 'MASS',
        effectiveNutritionBasis: {
          basis: 'PER_100_G',
          origin: 'INFERRED',
          source: 'OPEN_FOOD_FACTS',
          ruleId: 'OPEN_FOOD_FACTS_PORTION_DIMENSION',
        },
        package: { size: 150, baseUnit: 'G' },
        serving: null,
        containerKey: 'PACKAGE',
      },
    });

    // Second scan of the same barcode: local DB hit -> Open Food Facts is
    // NOT called again.
    const second = await request(app.getHttpServer())
      .get(`/food/barcode/${barcode}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(offLookupByBarcode).toHaveBeenCalledTimes(1);
    expect((second.body as { id: string }).id).toBe(productId);

    // Logging the resolved product computes calories from its cached
    // per-100g values, still without a second Open Food Facts call.
    const logged = await request(app.getHttpServer())
      .post('/food/logs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sourceType: 'PACKAGED_PRODUCT',
        sourceRef: productId,
        amount: 40,
        amountUnit: 'G',
        portionKind: 'CUSTOM',
        mealCategory: 'BREAKFAST',
        loggedAtUtc: '2026-01-15T08:00:00.000Z',
      })
      .expect(201);
    expect(offLookupByBarcode).toHaveBeenCalledTimes(1);
    expect(
      Number((logged.body as { caloriesComputed: string }).caloriesComputed),
    ).toBeCloseTo(100, 5); // 250/100 * 40
    expect(
      Number((logged.body as { proteinComputed: string }).proteinComputed),
    ).toBeCloseTo(2, 5);
    expect(
      Number((logged.body as { carbsComputed: string }).carbsComputed),
    ).toBeCloseTo(12, 5);
    expect(
      Number((logged.body as { fatComputed: string }).fatComputed),
    ).toBeCloseTo(4, 5);
    expect((logged.body as { amount: string }).amount).toBe('40');
    expect((logged.body as { mealCategory: string }).mealCategory).toBe(
      'BREAKFAST',
    );

    await prisma.packagedProduct.delete({ where: { id: productId } });
  });

  it('creates a volume log in ML and enforces validation and safety at the HTTP boundary', async () => {
    const barcode = ean13WithValidCheckDigit(
      `500006${testSuffix}`.padEnd(12, '6').slice(0, 12),
    );
    const product = await prisma.packagedProduct.create({
      data: {
        barcode,
        name: 'Volume logging product',
        packageSize: 330,
        packageBaseUnit: 'ML',
        servingSize: 250,
        servingBaseUnit: 'ML',
        caloriesPer100g: 42,
        source: ProductSource.OPEN_FOOD_FACTS,
        verificationStatus: VerificationStatus.EXTERNAL,
      },
    });
    const token = await newVerifiedUser('volume-log');

    const logged = await request(app.getHttpServer())
      .post('/food/logs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sourceType: 'PACKAGED_PRODUCT',
        sourceRef: product.id,
        amount: 330,
        amountUnit: 'ML',
        portionKind: 'CUSTOM',
        mealCategory: 'BREAKFAST',
        loggedAtUtc: '2026-01-15T08:00:00.000Z',
      })
      .expect(201);

    expect(logged.body).toMatchObject({
      amount: '330',
      amountUnit: 'ML',
      portionKind: 'CUSTOM',
      portionMultiplier: null,
    });
    expect(
      Number((logged.body as { caloriesComputed: string }).caloriesComputed),
    ).toBeCloseTo(138.6, 5);

    await request(app.getHttpServer())
      .post('/food/logs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sourceType: 'PACKAGED_PRODUCT',
        sourceRef: product.id,
        grams: 330,
        mealCategory: 'BREAKFAST',
        loggedAtUtc: '2026-01-15T08:00:00.000Z',
      })
      .expect(400);

    const malformed = await request(app.getHttpServer())
      .post('/food/logs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sourceType: 'PACKAGED_PRODUCT',
        sourceRef: product.id,
        amount: '330',
        amountUnit: 'ML',
        portionKind: 'CUSTOM',
        mealCategory: 'BREAKFAST',
        loggedAtUtc: '2026-01-15T08:00:00.000Z',
      })
      .expect(400);
    expect(malformed.body).toMatchObject({ reason: 'NOT_NUMERIC' });

    await prisma.packagedProduct.delete({ where: { id: product.id } });
  });

  it('returns a NOT_LOGGABLE resolution for a Not scalable cached Packaged product', async () => {
    const barcode = ean13WithValidCheckDigit(
      `500008${testSuffix}`.padEnd(12, '8').slice(0, 12),
    );
    const product = await prisma.packagedProduct.create({
      data: {
        barcode,
        name: 'Basis unknown product',
        brand: 'Test Brand',
        imageUrl: 'https://images.example/basis-unknown.jpg',
        caloriesPer100g: 100,
        packageSize: 500,
        packageBaseUnit: 'ML',
        source: ProductSource.ADMIN,
        verificationStatus: VerificationStatus.UNVERIFIED,
      },
    });
    const token = await newVerifiedUser('barcode-not-loggable');

    const response = await request(app.getHttpServer())
      .get(`/food/barcode/${barcode}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toMatchObject({
      id: product.id,
      name: 'Basis unknown product',
      caloriesPer100g: 100,
      resolution: {
        outcome: 'NOT_LOGGABLE',
        display: {
          name: 'Basis unknown product',
          brand: 'Test Brand',
          imageUrl: 'https://images.example/basis-unknown.jpg',
        },
        subjectKind: 'PACKAGED_PRODUCT',
        primaryReason: 'NUTRITION_BASIS_UNKNOWN',
      },
    });

    await prisma.packagedProduct.delete({ where: { id: product.id } });
  });

  it('returns and persists a distinct identified-without-nutrition result', async () => {
    const barcode = ean13WithValidCheckDigit(
      `500009${testSuffix}`.padEnd(12, '1').slice(0, 12),
    );
    offLookupByBarcode.mockResolvedValueOnce({
      outcome: 'FOUND_WITHOUT_NUTRITION',
      identification: {
        barcode,
        name: 'Known product without nutrition',
        brand: 'Known Brand',
        imageUrl: 'https://images.example/known-no-nutrition.jpg',
      },
    });
    const token = await newVerifiedUser('identified-no-nutrition');

    const response = await request(app.getHttpServer())
      .get(`/food/barcode/${barcode}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toEqual({
      barcode,
      name: 'Known product without nutrition',
      brand: 'Known Brand',
      imageUrl: 'https://images.example/known-no-nutrition.jpg',
      resolution: {
        outcome: 'NOT_LOGGABLE',
        display: {
          name: 'Known product without nutrition',
          brand: 'Known Brand',
          imageUrl: 'https://images.example/known-no-nutrition.jpg',
        },
        subjectKind: 'IDENTIFIED_NOT_CATALOGUED',
        primaryReason: 'NUTRITION_MISSING',
      },
    });
    await expect(
      prisma.packagedProduct.findUnique({ where: { barcode } }),
    ).resolves.toBeNull();
    await expect(
      prisma.identifiedBarcode.findUnique({ where: { barcode } }),
    ).resolves.toMatchObject({
      displayName: 'Known product without nutrition',
      reason: 'NUTRITION_MISSING',
    });

    await prisma.identifiedBarcode.delete({ where: { barcode } });
  });

  it('returns 404 (not 500) when a barcode is unknown to both the local DB and Open Food Facts', async () => {
    const barcode = ean13WithValidCheckDigit(
      `500001${testSuffix}`.padEnd(12, '2').slice(0, 12),
    );
    offLookupByBarcode.mockResolvedValueOnce({ outcome: 'NOT_FOUND' });
    const token = await newVerifiedUser('barcode-miss');

    await request(app.getHttpServer())
      .get(`/food/barcode/${barcode}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('returns 503, distinct from not-found, when Open Food Facts is unavailable', async () => {
    const barcode = ean13WithValidCheckDigit(
      `500004${testSuffix}`.padEnd(12, '5').slice(0, 12),
    );
    offLookupByBarcode.mockRejectedValueOnce(new Error('OFF timed out'));
    const token = await newVerifiedUser('barcode-outage');

    await request(app.getHttpServer())
      .get(`/food/barcode/${barcode}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(503);
  });

  it('rejects a malformed barcode with 400 before ever calling Open Food Facts', async () => {
    const token = await newVerifiedUser('barcode-invalid');

    await request(app.getHttpServer())
      .get('/food/barcode/not-a-barcode')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    expect(offLookupByBarcode).not.toHaveBeenCalled();
  });

  it('lets a user submit an unknown product, then discovers it by barcode afterwards', async () => {
    const barcode = ean13WithValidCheckDigit(
      `500002${testSuffix}`.padEnd(12, '3').slice(0, 12),
    );
    offLookupByBarcode.mockResolvedValueOnce({ outcome: 'NOT_FOUND' });
    const token = await newVerifiedUser('user-submit');

    await request(app.getHttpServer())
      .get(`/food/barcode/${barcode}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    const submitted = await request(app.getHttpServer())
      .post('/food/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        barcode,
        name: 'Homemade Karkade Concentrate',
        brand: "Grandma's",
        declaredNutritionBasis: NutritionBasis.PER_100_G,
        caloriesPer100g: 45,
        proteinPer100g: 0.2,
        carbsPer100g: 11,
        fatPer100g: 0,
      })
      .expect(201);
    expect((submitted.body as { source: string }).source).toBe(
      'USER_SUBMITTED',
    );
    expect(
      (submitted.body as { verificationStatus: string }).verificationStatus,
    ).toBe('UNVERIFIED');

    const found = await request(app.getHttpServer())
      .get(`/food/barcode/${barcode}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((found.body as { name: string }).name).toBe(
      'Homemade Karkade Concentrate',
    );

    const duplicate = await request(app.getHttpServer())
      .post('/food/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        barcode,
        name: 'Duplicate attempt',
        declaredNutritionBasis: NutritionBasis.PER_100_G,
        caloriesPer100g: 1,
        proteinPer100g: 1,
        carbsPer100g: 1,
        fatPer100g: 1,
      })
      .expect(409);
    expect((duplicate.body as { message: string }).message).toMatch(
      /already exists/i,
    );

    await prisma.packagedProduct.delete({ where: { barcode } });
  });

  it('rejects a product submission with negative nutrition values', async () => {
    const barcode = ean13WithValidCheckDigit(
      `500003${testSuffix}`.padEnd(12, '4').slice(0, 12),
    );
    const token = await newVerifiedUser('user-submit-invalid');

    await request(app.getHttpServer())
      .post('/food/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        barcode,
        name: 'Bad Data Product',
        caloriesPer100g: -10,
        proteinPer100g: 1,
        carbsPer100g: 1,
        fatPer100g: 1,
      })
      .expect(400);
  });

  it('rejects a product submission without a Declared basis', async () => {
    const barcode = ean13WithValidCheckDigit(
      `500012${testSuffix}`.padEnd(12, '2').slice(0, 12),
    );
    const token = await newVerifiedUser('legacy-product-mass');

    const response = await request(app.getHttpServer())
      .post('/food/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        barcode,
        name: 'Missing Basis Product',
        packageSize: 250,
        packageUnit: 'g',
        caloriesPer100g: 100,
        proteinPer100g: 2,
        carbsPer100g: 20,
        fatPer100g: 1,
      })
      .expect(400);

    expect(response.body).toMatchObject({
      reason: 'DECLARED_NUTRITION_BASIS_REQUIRED',
    });
    await expect(
      prisma.packagedProduct.findUnique({ where: { barcode } }),
    ).resolves.toBeNull();
  });

  it('rejects a mass-basis product submission with a volume package', async () => {
    const barcode = ean13WithValidCheckDigit(
      `500013${testSuffix}`.padEnd(12, '3').slice(0, 12),
    );
    const token = await newVerifiedUser('legacy-product-volume');

    const response = await request(app.getHttpServer())
      .post('/food/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        barcode,
        name: 'Conflicting Drink',
        packageSize: 330,
        packageUnit: 'ml',
        declaredNutritionBasis: NutritionBasis.PER_100_G,
        caloriesPer100g: 42,
        proteinPer100g: 0,
        carbsPer100g: 10.5,
        fatPer100g: 0,
      })
      .expect(400);

    expect(response.body).toMatchObject({
      reason: 'DIMENSION_BASIS_CONFLICT',
    });
    await expect(
      prisma.packagedProduct.findUnique({ where: { barcode } }),
    ).resolves.toBeNull();
  });

  it('keeps two pack sizes with the same brand and name as distinct products', async () => {
    const firstBarcode = ean13WithValidCheckDigit(
      `500005${testSuffix}`.padEnd(12, '6').slice(0, 12),
    );
    const secondBarcode = ean13WithValidCheckDigit(
      `500006${testSuffix}`.padEnd(12, '7').slice(0, 12),
    );
    const token = await newVerifiedUser('pack-sizes');
    const base = {
      name: 'Same Branded Drink',
      brand: 'Same Brand',
      packageUnit: 'ml',
      declaredNutritionBasis: NutritionBasis.PER_100_ML,
      caloriesPer100g: 42,
      proteinPer100g: 0,
      carbsPer100g: 10.5,
      fatPer100g: 0,
    };

    const first = await request(app.getHttpServer())
      .post('/food/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...base, barcode: firstBarcode, packageSize: 330 })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post('/food/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...base, barcode: secondBarcode, packageSize: 1000 })
      .expect(201);

    expect((first.body as { id: string }).id).not.toBe(
      (second.body as { id: string }).id,
    );
    await request(app.getHttpServer())
      .get(`/food/barcode/${firstBarcode}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect((res.body as { packageSize: number }).packageSize).toBe(330);
      });
    await request(app.getHttpServer())
      .get(`/food/barcode/${secondBarcode}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect((res.body as { packageSize: number }).packageSize).toBe(1000);
      });

    await prisma.packagedProduct.deleteMany({
      where: { barcode: { in: [firstBarcode, secondBarcode] } },
    });
  });

  it('allows manual submission after nutrition-label extraction reports unavailable', async () => {
    const barcode = ean13WithValidCheckDigit(
      `500007${testSuffix}`.padEnd(12, '8').slice(0, 12),
    );
    const token = await newVerifiedUser('label-fallback');

    const extraction = await request(app.getHttpServer())
      .post('/food/nutrition-label/extract')
      .set('Authorization', `Bearer ${token}`)
      .attach('image', Buffer.from('test-image'), {
        filename: 'nutrition-label.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);
    expect(extraction.body).toMatchObject({ available: false });

    await request(app.getHttpServer())
      .post('/food/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        barcode,
        name: 'Manually Entered Product',
        declaredNutritionBasis: NutritionBasis.PER_100_G,
        caloriesPer100g: 100,
        proteinPer100g: 2,
        carbsPer100g: 20,
        fatPer100g: 1,
      })
      .expect(201);

    await prisma.packagedProduct.delete({ where: { barcode } });
  });

  it('makes an imported product discoverable through the normal scan flow', async () => {
    const barcode = ean13WithValidCheckDigit(
      `500008${testSuffix}`.padEnd(12, '9').slice(0, 12),
    );
    const records = parsePackagedProductRecords(
      JSON.stringify([
        {
          barcode,
          name: 'Imported Egyptian Product',
          caloriesPer100g: 180,
          proteinPer100g: 3,
          carbsPer100g: 25,
          fatPer100g: 7,
        },
      ]),
      'json',
    );
    await importPackagedProducts(records, prisma);
    const token = await newVerifiedUser('import-discovery');

    const found = await request(app.getHttpServer())
      .get(`/food/barcode/${barcode}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect((found.body as { name: string }).name).toBe(
      'Imported Egyptian Product',
    );
    expect(offLookupByBarcode).not.toHaveBeenCalled();
    await prisma.packagedProduct.delete({ where: { barcode } });
  });

  it('POST /food/logs with sourceType CANONICAL computes calories from the catalog entry', async () => {
    const token = await newVerifiedUser('canonical-log');
    const canonicalId = createdCanonicalFoodIds[0]; // Test Chicken Breast, 120 kcal/100g

    const created = await request(app.getHttpServer())
      .post('/food/logs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sourceType: 'CANONICAL',
        sourceRef: canonicalId,
        amount: 200,
        amountUnit: 'G',
        mealCategory: 'LUNCH',
        loggedAtUtc: '2026-01-15T12:00:00.000Z',
      })
      .expect(201);

    const body = created.body as { caloriesComputed: string };
    expect(Number(body.caloriesComputed)).toBeCloseTo(240, 5); // 120/100 * 200
  });
});
