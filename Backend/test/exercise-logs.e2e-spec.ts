import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/modules/mail/mail.service';
import { globalValidationPipe } from '../src/common/pipes/validation.pipe';

// Covers specs/004-exercise-tracking-page/contracts/exercise-logs-api.md:
// POST/PATCH/DELETE/GET /exercise-logs and GET /sports.
describe('Exercise logs (e2e)', () => {
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

  async function onboard(accessToken: string) {
    await request(app.getHttpServer())
      .post('/onboarding')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        age: 30,
        sex: 'MALE',
        heightCm: 180,
        currentWeightKg: 80,
        goalWeightKg: 75,
        activityLevel: 'SEDENTARY',
        timezone: 'UTC',
      })
      .expect(201);
  }

  async function newVerifiedOnboardedUser(tag: string) {
    const email = `exlog-${tag}-${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;
    const { accessToken } = await signupAndVerify(email);
    await onboard(accessToken);
    return accessToken;
  }

  it('GET /sports returns the fixed catalog', async () => {
    const accessToken = await newVerifiedOnboardedUser('sports');

    const res = await request(app.getHttpServer())
      .get('/sports')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const sportTypes = (res.body as { sportType: string }[]).map(
      (s) => s.sportType,
    );
    expect(sportTypes).toEqual(
      expect.arrayContaining([
        'FOOTBALL',
        'SWIMMING',
        'PADEL',
        'BASKETBALL',
        'GYM_WEIGHTS',
        'RUNNING',
        'TENNIS',
        'OTHER',
      ]),
    );
  });

  it('POST /exercise-logs creates a session with server-calculated calories', async () => {
    const accessToken = await newVerifiedOnboardedUser('create');

    const res = await request(app.getHttpServer())
      .post('/exercise-logs')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ sportType: 'RUNNING', durationMinutes: 30, date: '2026-01-15' })
      .expect(201);

    expect(res.body).toMatchObject({
      sportType: 'RUNNING',
      durationMinutes: 30,
    });
    expect(Number(res.body.caloriesBurned)).toBeGreaterThan(0);
  });

  it('POST /exercise-logs with sportType OTHER requires and stores customSportName', async () => {
    const accessToken = await newVerifiedOnboardedUser('other');

    const res = await request(app.getHttpServer())
      .post('/exercise-logs')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        sportType: 'OTHER',
        customSportName: 'Rock Climbing',
        durationMinutes: 40,
        date: '2026-01-15',
      })
      .expect(201);

    expect(res.body.customSportName).toBe('Rock Climbing');

    await request(app.getHttpServer())
      .post('/exercise-logs')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ sportType: 'OTHER', durationMinutes: 40, date: '2026-01-15' })
      .expect(400);
  });

  it('rejects a duration of 0 and a duration over 1440 minutes', async () => {
    const accessToken = await newVerifiedOnboardedUser('duration');

    await request(app.getHttpServer())
      .post('/exercise-logs')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ sportType: 'RUNNING', durationMinutes: 0, date: '2026-01-15' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/exercise-logs')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ sportType: 'RUNNING', durationMinutes: 1500, date: '2026-01-15' })
      .expect(400);
  });

  it('rejects logging exercise when the user has no baseline', async () => {
    const email = `exlog-nobaseline-${Date.now()}@example.com`;
    const { accessToken } = await signupAndVerify(email);

    await request(app.getHttpServer())
      .post('/exercise-logs')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ sportType: 'RUNNING', durationMinutes: 30, date: '2026-01-15' })
      .expect(400);
  });

  it('PATCH /exercise-logs/:id recalculates calories on sport/duration change', async () => {
    const accessToken = await newVerifiedOnboardedUser('edit');

    const created = await request(app.getHttpServer())
      .post('/exercise-logs')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ sportType: 'RUNNING', durationMinutes: 30, date: '2026-01-15' })
      .expect(201);

    const originalCalories = Number(created.body.caloriesBurned);
    const id = created.body.id as string;

    const durationEdit = await request(app.getHttpServer())
      .patch(`/exercise-logs/${id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ durationMinutes: 20 })
      .expect(200);

    expect(durationEdit.body.id).toBe(id);
    expect(durationEdit.body.durationMinutes).toBe(20);
    expect(Number(durationEdit.body.caloriesBurned)).not.toBe(originalCalories);

    const sportEdit = await request(app.getHttpServer())
      .patch(`/exercise-logs/${id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ sportType: 'SWIMMING' })
      .expect(200);

    expect(sportEdit.body.sportType).toBe('SWIMMING');
    expect(Number(sportEdit.body.caloriesBurned)).not.toBe(
      Number(durationEdit.body.caloriesBurned),
    );
  });

  it("PATCH /exercise-logs/:id on another user's entry returns 404", async () => {
    const ownerToken = await newVerifiedOnboardedUser('owner');
    const strangerToken = await newVerifiedOnboardedUser('stranger');

    const created = await request(app.getHttpServer())
      .post('/exercise-logs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ sportType: 'TENNIS', durationMinutes: 60, date: '2026-01-15' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/exercise-logs/${created.body.id}`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ durationMinutes: 10 })
      .expect(404);
  });

  it('DELETE /exercise-logs/:id removes the entry; another user cannot delete it', async () => {
    const accessToken = await newVerifiedOnboardedUser('delete');

    const created = await request(app.getHttpServer())
      .post('/exercise-logs')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        sportType: 'BASKETBALL',
        durationMinutes: 45,
        date: '2026-01-15',
      })
      .expect(201);

    const strangerToken = await newVerifiedOnboardedUser('delete-stranger');
    await request(app.getHttpServer())
      .delete(`/exercise-logs/${created.body.id}`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/exercise-logs/${created.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    const list = await request(app.getHttpServer())
      .get('/exercise-logs')
      .query({ date: '2026-01-15' })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(list.body).toEqual([]);
  });

  it("GET /exercise-logs lists only the requesting user's sessions for the date, most recent first", async () => {
    const accessToken = await newVerifiedOnboardedUser('list');

    const first = await request(app.getHttpServer())
      .post('/exercise-logs')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ sportType: 'FOOTBALL', durationMinutes: 60, date: '2026-01-16' })
      .expect(201);

    const second = await request(app.getHttpServer())
      .post('/exercise-logs')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ sportType: 'PADEL', durationMinutes: 45, date: '2026-01-16' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/exercise-logs')
      .query({ date: '2026-01-16' })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body).toHaveLength(2);
    expect(res.body[0].id).toBe(second.body.id);
    expect(res.body[1].id).toBe(first.body.id);
  });

  it('GET /exercise-logs returns an empty array when nothing logged for the date', async () => {
    const accessToken = await newVerifiedOnboardedUser('empty');

    const res = await request(app.getHttpServer())
      .get('/exercise-logs')
      .query({ date: '2026-01-17' })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body).toEqual([]);
  });
});
