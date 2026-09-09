import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/modules/mail/mail.service';
import { globalValidationPipe } from '../src/common/pipes/validation.pipe';

// Covers specs/009-workout-tracking (issue #4) tickets #5 and #6:
// GET /workout-exercises and POST /workout-sessions.
describe('Workouts (e2e)', () => {
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
    const email = `workout-${tag}-${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;
    const { accessToken } = await signupAndVerify(email);
    return accessToken;
  }

  describe('GET /workout-exercises', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer()).get('/workout-exercises').expect(401);
    });

    it('returns the fixed catalog, covering every muscle group', async () => {
      const accessToken = await newVerifiedUser('catalog');

      const res = await request(app.getHttpServer())
        .get('/workout-exercises')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const entries = res.body as {
        exerciseType: string;
        label: string;
        muscleGroup: string;
      }[];

      expect(entries.length).toBeGreaterThan(50);

      const muscleGroups = new Set(entries.map((e) => e.muscleGroup));
      expect(muscleGroups).toEqual(
        new Set(['CHEST', 'BACK', 'SHOULDERS', 'BICEPS', 'TRICEPS', 'LEGS', 'CORE']),
      );

      expect(entries).toEqual(
        expect.arrayContaining([
          { exerciseType: 'LAT_PULLDOWN', label: 'Lat Pulldown', muscleGroup: 'BACK' },
          { exerciseType: 'SEATED_CABLE_ROW', label: 'Seated Cable Row', muscleGroup: 'BACK' },
          {
            exerciseType: 'INCLINE_MACHINE_CHEST_PRESS',
            label: 'Incline Chest Press (Machine)',
            muscleGroup: 'CHEST',
          },
        ]),
      );

      // Every exercise type in the catalog is unique — no duplicates.
      const exerciseTypes = entries.map((e) => e.exerciseType);
      expect(new Set(exerciseTypes).size).toBe(exerciseTypes.length);
    });
  });

  describe('POST /workout-sessions', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post('/workout-sessions')
        .send({
          date: '2026-01-15',
          muscleGroups: ['CHEST'],
          exercises: [{ exerciseType: 'BARBELL_BENCH_PRESS', sets: [{ reps: 10 }] }],
        })
        .expect(401);
    });

    it('creates a session atomically with multiple muscle groups, exercises, and sets, returning the full nested shape', async () => {
      const accessToken = await newVerifiedUser('create');

      const res = await request(app.getHttpServer())
        .post('/workout-sessions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          date: '2026-01-15',
          muscleGroups: ['CHEST', 'TRICEPS'],
          exercises: [
            {
              exerciseType: 'BARBELL_BENCH_PRESS',
              sets: [
                { reps: 10, weightKg: 60 },
                { reps: 8, weightKg: 65.5 },
              ],
            },
            {
              exerciseType: 'PUSH_UPS',
              sets: [{ reps: 20 }],
            },
          ],
        })
        .expect(201);

      expect(res.body.muscleGroups).toEqual(['CHEST', 'TRICEPS']);
      expect(res.body.exercises).toHaveLength(2);

      const [benchPress, pushUps] = res.body.exercises as {
        exerciseType: string;
        sets: { reps: number; weightKg: string | null }[];
      }[];

      expect(benchPress.exerciseType).toBe('BARBELL_BENCH_PRESS');
      expect(benchPress.sets).toHaveLength(2);
      expect(benchPress.sets[0]).toMatchObject({ reps: 10 });
      expect(Number(benchPress.sets[0].weightKg)).toBe(60);
      expect(Number(benchPress.sets[1].weightKg)).toBe(65.5);

      expect(pushUps.exerciseType).toBe('PUSH_UPS');
      expect(pushUps.sets).toHaveLength(1);
      expect(pushUps.sets[0]).toMatchObject({ reps: 20 });
      // Bodyweight set: weight omitted, never coerced to 0.
      expect(pushUps.sets[0].weightKg).toBeNull();
    });

    it('rejects a session with no muscle groups', async () => {
      const accessToken = await newVerifiedUser('no-groups');

      await request(app.getHttpServer())
        .post('/workout-sessions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          date: '2026-01-15',
          muscleGroups: [],
          exercises: [{ exerciseType: 'BARBELL_BENCH_PRESS', sets: [{ reps: 10 }] }],
        })
        .expect(400);
    });

    it('rejects an exercise with no sets', async () => {
      const accessToken = await newVerifiedUser('no-sets');

      await request(app.getHttpServer())
        .post('/workout-sessions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          date: '2026-01-15',
          muscleGroups: ['CHEST'],
          exercises: [{ exerciseType: 'BARBELL_BENCH_PRESS', sets: [] }],
        })
        .expect(400);
    });

    it('rejects non-positive reps', async () => {
      const accessToken = await newVerifiedUser('bad-reps');

      await request(app.getHttpServer())
        .post('/workout-sessions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          date: '2026-01-15',
          muscleGroups: ['CHEST'],
          exercises: [{ exerciseType: 'BARBELL_BENCH_PRESS', sets: [{ reps: 0 }] }],
        })
        .expect(400);
    });

    it('rejects a weight with more than 2 decimal places', async () => {
      const accessToken = await newVerifiedUser('bad-weight');

      await request(app.getHttpServer())
        .post('/workout-sessions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          date: '2026-01-15',
          muscleGroups: ['CHEST'],
          exercises: [
            { exerciseType: 'BARBELL_BENCH_PRESS', sets: [{ reps: 10, weightKg: 60.123 }] },
          ],
        })
        .expect(400);
    });

    it('rejects a weight of exactly 0 — bodyweight sets must omit weight, never send 0', async () => {
      const accessToken = await newVerifiedUser('zero-weight');

      await request(app.getHttpServer())
        .post('/workout-sessions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          date: '2026-01-15',
          muscleGroups: ['CHEST'],
          exercises: [{ exerciseType: 'PUSH_UPS', sets: [{ reps: 20, weightKg: 0 }] }],
        })
        .expect(400);
    });

    it('rejects a future date', async () => {
      const accessToken = await newVerifiedUser('future-date');

      const tomorrow = new Date();
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const futureDate = tomorrow.toISOString().slice(0, 10);

      await request(app.getHttpServer())
        .post('/workout-sessions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          date: futureDate,
          muscleGroups: ['CHEST'],
          exercises: [{ exerciseType: 'BARBELL_BENCH_PRESS', sets: [{ reps: 10 }] }],
        })
        .expect(400);
    });

    it('rejects an unknown exercise type or muscle group', async () => {
      const accessToken = await newVerifiedUser('bad-enum');

      await request(app.getHttpServer())
        .post('/workout-sessions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          date: '2026-01-15',
          muscleGroups: ['NOT_A_MUSCLE_GROUP'],
          exercises: [{ exerciseType: 'BARBELL_BENCH_PRESS', sets: [{ reps: 10 }] }],
        })
        .expect(400);
    });
  });
});
