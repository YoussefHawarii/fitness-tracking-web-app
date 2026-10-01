import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/modules/mail/mail.service';
import { globalValidationPipe } from '../src/common/pipes/validation.pipe';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProductSource, VerificationStatus } from '@prisma/client';

// Covers specs/007-date-picker-food-log-edit/contracts/food-logs-edit-delete.md:
// PATCH/DELETE /food/logs/:id.
describe('Food logs edit/delete (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sentOtpEmails: { to: string; code: string }[] = [];

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
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(globalValidationPipe);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function signupAndVerify(email: string) {
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        username: `user${Date.now()}${Math.floor(Math.random() * 1_000_000)}`,
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

    return verifyRes.body as { accessToken: string };
  }

  async function newVerifiedUser(tag: string) {
    const email = `foodlog-${tag}-${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;
    const { accessToken } = await signupAndVerify(email);
    return accessToken;
  }

  async function createLoggedFoodEntry(
    accessToken: string,
    overrides: { amount?: number; mealCategory?: string } = {},
  ) {
    const localItem = await request(app.getHttpServer())
      .post('/food/local-items')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Grilled chicken breast', caloriesPer100g: 165 })
      .expect(201);
    const localItemBody = localItem.body as { id: string };

    const created = await request(app.getHttpServer())
      .post('/food/logs')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        sourceType: 'LOCAL',
        sourceRef: localItemBody.id,
        amount: overrides.amount ?? 100,
        amountUnit: 'G',
        mealCategory: overrides.mealCategory ?? 'LUNCH',
        loggedAtUtc: '2026-01-15T12:00:00.000Z',
      })
      .expect(201);

    return created.body as { id: string; caloriesComputed: string };
  }

  async function createVolumeEntry(accessToken: string, tag: string) {
    const product = await prisma.packagedProduct.create({
      data: {
        barcode: `edit-volume-${tag}-${Date.now()}-${Math.random()}`,
        name: 'Editable drink',
        packageSize: 600,
        packageBaseUnit: 'ML',
        servingSize: 250,
        servingBaseUnit: 'ML',
        caloriesPer100g: 42,
        source: ProductSource.OPEN_FOOD_FACTS,
        verificationStatus: VerificationStatus.EXTERNAL,
      },
    });
    const logged = await request(app.getHttpServer())
      .post('/food/logs')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        sourceType: 'PACKAGED_PRODUCT',
        sourceRef: product.id,
        amount: 250,
        amountUnit: 'ML',
        portionKind: 'SERVING',
        portionMultiplier: 1,
        mealCategory: 'LUNCH',
        loggedAtUtc: '2026-01-15T12:00:00.000Z',
      })
      .expect(201);
    return { product, entry: logged.body as { id: string } };
  }

  it('PATCH /food/logs/:id recalculates calories when amount changes', async () => {
    const accessToken = await newVerifiedUser('edit-amount');
    const entry = await createLoggedFoodEntry(accessToken, { amount: 100 });
    const originalCalories = Number(entry.caloriesComputed);

    const edited = await request(app.getHttpServer())
      .patch(`/food/logs/${entry.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: 200, amountUnit: 'G' })
      .expect(200);
    const editedBody = edited.body as {
      amount: string;
      caloriesComputed: string;
    };

    expect(Number(editedBody.amount)).toBe(200);
    expect(Number(editedBody.caloriesComputed)).toBeCloseTo(
      originalCalories * 2,
      5,
    );
  });

  it('PATCH /food/logs/:id edits an ML amount with the new transport', async () => {
    const accessToken = await newVerifiedUser('edit-ml');
    const { product, entry } = await createVolumeEntry(accessToken, 'edit');

    const edited = await request(app.getHttpServer())
      .patch(`/food/logs/${entry.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        amount: 500,
        amountUnit: 'ML',
        portionKind: 'SERVING',
        portionMultiplier: 2,
        mealCategory: 'DINNER',
      })
      .expect(200);

    expect(edited.body).toMatchObject({
      amount: '500',
      amountUnit: 'ML',
      portionKind: 'SERVING',
      portionMultiplier: '2',
      mealCategory: 'DINNER',
    });
    await prisma.foodLogEntry.delete({ where: { id: entry.id } });
    await prisma.packagedProduct.delete({ where: { id: product.id } });
  });

  it('allows meal-only but rejects amount edits after a product becomes Not scalable', async () => {
    const accessToken = await newVerifiedUser('edit-not-scalable');
    const { product, entry } = await createVolumeEntry(
      accessToken,
      'not-scalable',
    );
    await prisma.packagedProduct.update({
      where: { id: product.id },
      data: { source: ProductSource.ADMIN },
    });

    const rejected = await request(app.getHttpServer())
      .patch(`/food/logs/${entry.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        amount: 300,
        amountUnit: 'ML',
        portionKind: 'CUSTOM',
        mealCategory: 'LUNCH',
      })
      .expect(422);
    expect(rejected.body).toMatchObject({ reason: 'NUTRITION_BASIS_UNKNOWN' });

    const mealOnly = await request(app.getHttpServer())
      .patch(`/food/logs/${entry.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ mealCategory: 'DINNER' })
      .expect(200);
    expect(mealOnly.body).toMatchObject({
      amount: '250',
      amountUnit: 'ML',
      portionKind: 'SERVING',
      mealCategory: 'DINNER',
    });
    await prisma.foodLogEntry.delete({ where: { id: entry.id } });
    await prisma.packagedProduct.delete({ where: { id: product.id } });
  });

  it('treats an unchanged amount as meal-only when a product becomes Not scalable', async () => {
    const accessToken = await newVerifiedUser('edit-unchanged');
    const product = await prisma.packagedProduct.create({
      data: {
        barcode: `edit-mass-${Date.now()}-${Math.random()}`,
        name: 'Mass product',
        packageSize: 300,
        packageBaseUnit: 'G',
        caloriesPer100g: 200,
        source: ProductSource.OPEN_FOOD_FACTS,
        verificationStatus: VerificationStatus.EXTERNAL,
      },
    });
    const logged = await request(app.getHttpServer())
      .post('/food/logs')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        sourceType: 'PACKAGED_PRODUCT',
        sourceRef: product.id,
        amount: 100,
        amountUnit: 'G',
        portionKind: 'CUSTOM',
        mealCategory: 'LUNCH',
        loggedAtUtc: '2026-01-15T12:00:00.000Z',
      })
      .expect(201);
    const entry = logged.body as {
      id: string;
      caloriesComputed: string;
    };
    await prisma.packagedProduct.update({
      where: { id: product.id },
      data: { source: ProductSource.ADMIN },
    });

    const edited = await request(app.getHttpServer())
      .patch(`/food/logs/${entry.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        amount: 100,
        amountUnit: 'G',
        portionKind: 'CUSTOM',
        mealCategory: 'DINNER',
      })
      .expect(200);
    const editedBody = edited.body as {
      amount: string;
      amountUnit: string;
      caloriesComputed: string;
      mealCategory: string;
    };

    expect(editedBody).toMatchObject({
      amount: '100',
      amountUnit: 'G',
      caloriesComputed: entry.caloriesComputed,
      mealCategory: 'DINNER',
    });
    await prisma.foodLogEntry.delete({ where: { id: entry.id } });
    await prisma.packagedProduct.delete({ where: { id: product.id } });
  });

  it('keeps an orphaned packaged-product entry uneditable', async () => {
    const accessToken = await newVerifiedUser('edit-orphan');
    const { product, entry } = await createVolumeEntry(accessToken, 'orphan');
    await prisma.packagedProduct.delete({ where: { id: product.id } });

    await request(app.getHttpServer())
      .patch(`/food/logs/${entry.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ mealCategory: 'DINNER' })
      .expect(404);
    await prisma.foodLogEntry.delete({ where: { id: entry.id } });
  });

  it('PATCH /food/logs/:id updates mealCategory independently of amount', async () => {
    const accessToken = await newVerifiedUser('edit-meal');
    const entry = await createLoggedFoodEntry(accessToken, {
      mealCategory: 'LUNCH',
    });

    const edited = await request(app.getHttpServer())
      .patch(`/food/logs/${entry.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ mealCategory: 'DINNER' })
      .expect(200);
    const editedBody = edited.body as {
      mealCategory: string;
      caloriesComputed: string;
    };

    expect(editedBody.mealCategory).toBe('DINNER');
    expect(Number(editedBody.caloriesComputed)).toBeCloseTo(
      Number(entry.caloriesComputed),
      5,
    );
  });

  it('PATCH /food/logs/:id rejects a non-positive amount', async () => {
    const accessToken = await newVerifiedUser('edit-invalid');
    const entry = await createLoggedFoodEntry(accessToken);

    await request(app.getHttpServer())
      .patch(`/food/logs/${entry.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: 0, amountUnit: 'G' })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/food/logs/${entry.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: -5, amountUnit: 'G' })
      .expect(400);
  });

  it('PATCH /food/logs/:id rejects the retired grams field', async () => {
    const accessToken = await newVerifiedUser('edit-retired-field');
    const entry = await createLoggedFoodEntry(accessToken);

    await request(app.getHttpServer())
      .patch(`/food/logs/${entry.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ grams: 100 })
      .expect(400);
  });

  it("PATCH /food/logs/:id on another user's entry returns 404", async () => {
    const ownerToken = await newVerifiedUser('owner');
    const strangerToken = await newVerifiedUser('stranger');
    const entry = await createLoggedFoodEntry(ownerToken);

    await request(app.getHttpServer())
      .patch(`/food/logs/${entry.id}`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ amount: 50, amountUnit: 'G' })
      .expect(404);
  });

  it('DELETE /food/logs/:id removes the entry; a repeat delete returns 404', async () => {
    const accessToken = await newVerifiedUser('delete');
    const entry = await createLoggedFoodEntry(accessToken);

    await request(app.getHttpServer())
      .delete(`/food/logs/${entry.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    const list = await request(app.getHttpServer())
      .get('/food/logs')
      .query({ date: '2026-01-15' })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(list.body).toEqual([]);

    await request(app.getHttpServer())
      .delete(`/food/logs/${entry.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);
  });

  it("DELETE /food/logs/:id on another user's entry returns 404 and leaves it intact", async () => {
    const ownerToken = await newVerifiedUser('delete-owner');
    const strangerToken = await newVerifiedUser('delete-stranger');
    const entry = await createLoggedFoodEntry(ownerToken);

    await request(app.getHttpServer())
      .delete(`/food/logs/${entry.id}`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .expect(404);

    const list = await request(app.getHttpServer())
      .get('/food/logs')
      .query({ date: '2026-01-15' })
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(list.body).toHaveLength(1);
  });
});
