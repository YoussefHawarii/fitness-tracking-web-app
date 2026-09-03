import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/modules/mail/mail.service';
import { globalValidationPipe } from '../src/common/pipes/validation.pipe';

// Covers specs/007-date-picker-food-log-edit/contracts/food-logs-edit-delete.md:
// PATCH/DELETE /food/logs/:id.
describe('Food logs edit/delete (e2e)', () => {
  let app: INestApplication<App>;
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
    overrides: { grams?: number; mealCategory?: string } = {},
  ) {
    const localItem = await request(app.getHttpServer())
      .post('/food/local-items')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Grilled chicken breast', caloriesPer100g: 165 })
      .expect(201);

    const created = await request(app.getHttpServer())
      .post('/food/logs')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        sourceType: 'LOCAL',
        sourceRef: localItem.body.id,
        grams: overrides.grams ?? 100,
        mealCategory: overrides.mealCategory ?? 'LUNCH',
        loggedAtUtc: '2026-01-15T12:00:00.000Z',
      })
      .expect(201);

    return created.body as { id: string; caloriesComputed: string };
  }

  it('PATCH /food/logs/:id recalculates calories when grams change', async () => {
    const accessToken = await newVerifiedUser('edit-grams');
    const entry = await createLoggedFoodEntry(accessToken, { grams: 100 });
    const originalCalories = Number(entry.caloriesComputed);

    const edited = await request(app.getHttpServer())
      .patch(`/food/logs/${entry.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ grams: 200 })
      .expect(200);

    expect(Number(edited.body.grams)).toBe(200);
    expect(Number(edited.body.caloriesComputed)).toBeCloseTo(
      originalCalories * 2,
      5,
    );
  });

  it('PATCH /food/logs/:id updates mealCategory independently of grams', async () => {
    const accessToken = await newVerifiedUser('edit-meal');
    const entry = await createLoggedFoodEntry(accessToken, {
      mealCategory: 'LUNCH',
    });

    const edited = await request(app.getHttpServer())
      .patch(`/food/logs/${entry.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ mealCategory: 'DINNER' })
      .expect(200);

    expect(edited.body.mealCategory).toBe('DINNER');
    expect(Number(edited.body.caloriesComputed)).toBeCloseTo(
      Number(entry.caloriesComputed),
      5,
    );
  });

  it('PATCH /food/logs/:id rejects a non-positive grams value', async () => {
    const accessToken = await newVerifiedUser('edit-invalid');
    const entry = await createLoggedFoodEntry(accessToken);

    await request(app.getHttpServer())
      .patch(`/food/logs/${entry.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ grams: 0 })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/food/logs/${entry.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ grams: -5 })
      .expect(400);
  });

  it("PATCH /food/logs/:id on another user's entry returns 404", async () => {
    const ownerToken = await newVerifiedUser('owner');
    const strangerToken = await newVerifiedUser('stranger');
    const entry = await createLoggedFoodEntry(ownerToken);

    await request(app.getHttpServer())
      .patch(`/food/logs/${entry.id}`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ grams: 50 })
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
