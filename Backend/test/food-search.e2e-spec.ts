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

  it('reuses the scan-time Open Food Facts lookup at save time instead of re-fetching', async () => {
    const barcode = `999${testSuffix}`;
    offLookupByBarcode.mockResolvedValueOnce({
      barcode,
      name: 'Test Product',
      caloriesPer100g: 250,
      proteinPer100g: 5,
      carbsPer100g: 30,
      fatPer100g: 10,
    });
    const token = await newVerifiedUser('barcode-cache');

    await request(app.getHttpServer())
      .get(`/food/barcode/${barcode}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(offLookupByBarcode).toHaveBeenCalledTimes(1);

    await request(app.getHttpServer())
      .post('/food/logs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sourceType: 'OPEN_FOOD_FACTS',
        sourceRef: barcode,
        grams: 100,
        mealCategory: 'BREAKFAST',
        loggedAtUtc: '2026-01-15T08:00:00.000Z',
      })
      .expect(201);

    // Still only 1 — save reused the cached product rather than calling OFF again.
    expect(offLookupByBarcode).toHaveBeenCalledTimes(1);
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
        grams: 200,
        mealCategory: 'LUNCH',
        loggedAtUtc: '2026-01-15T12:00:00.000Z',
      })
      .expect(201);

    const body = created.body as { caloriesComputed: string };
    expect(Number(body.caloriesComputed)).toBeCloseTo(240, 5); // 120/100 * 200
  });
});
