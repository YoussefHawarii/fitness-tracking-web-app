import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/modules/mail/mail.service';
import { globalValidationPipe } from '../src/common/pipes/validation.pipe';

// Covers specs/009-workout-tracking (issue #4) tickets #5, #6, #7, and #8:
// GET /workout-exercises, the full POST/GET/PATCH/DELETE /workout-sessions
// CRUD, and GET /workout-exercises/:exerciseType/last.
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

  interface SessionOverrides {
    date?: string;
    muscleGroups?: string[];
    exercises?: {
      exerciseType: string;
      sets: { reps: number; weightKg?: number }[];
    }[];
  }

  async function createSession(
    accessToken: string,
    overrides: SessionOverrides = {},
  ) {
    const res = await request(app.getHttpServer())
      .post('/workout-sessions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        date: '2026-01-15',
        muscleGroups: ['CHEST'],
        exercises: [
          {
            exerciseType: 'BARBELL_BENCH_PRESS',
            sets: [{ reps: 10, weightKg: 60 }],
          },
        ],
        ...overrides,
      })
      .expect(201);
    return res.body as {
      id: string;
      muscleGroups: string[];
      loggedForDate: string;
      exercises: { id: string; exerciseType: string; sets: unknown[] }[];
    };
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
        new Set([
          'CHEST',
          'BACK',
          'SHOULDERS',
          'BICEPS',
          'TRICEPS',
          'LEGS',
          'CORE',
        ]),
      );

      expect(entries).toEqual(
        expect.arrayContaining([
          {
            exerciseType: 'LAT_PULLDOWN',
            label: 'Lat Pulldown',
            muscleGroup: 'BACK',
          },
          {
            exerciseType: 'SEATED_CABLE_ROW',
            label: 'Seated Cable Row',
            muscleGroup: 'BACK',
          },
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

  describe('GET /workout-exercises/:exerciseType/last', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .get('/workout-exercises/BARBELL_BENCH_PRESS/last')
        .expect(401);
    });

    it('rejects an unknown exercise type', async () => {
      const accessToken = await newVerifiedUser('last-bad-enum');

      await request(app.getHttpServer())
        .get('/workout-exercises/NOT_AN_EXERCISE/last')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400);
    });

    it('returns null when the user has never logged that exercise before', async () => {
      const accessToken = await newVerifiedUser('last-null');
      await createSession(accessToken, {
        exercises: [
          { exerciseType: 'LAT_PULLDOWN', sets: [{ reps: 10, weightKg: 40 }] },
        ],
      });

      const res = await request(app.getHttpServer())
        .get('/workout-exercises/BARBELL_BENCH_PRESS/last')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // Nest sends a null controller return value as an empty body (rather
      // than the literal JSON token `null`), which supertest/superagent
      // surfaces as `{}` — assert on that observable shape.
      expect(res.body).toEqual({});
    });

    it('returns the most recent prior session’s sets for that exercise, scoped to the requesting user', async () => {
      const accessToken = await newVerifiedUser('last-hit');

      await createSession(accessToken, {
        date: '2026-01-01',
        exercises: [
          {
            exerciseType: 'BARBELL_BENCH_PRESS',
            sets: [{ reps: 10, weightKg: 55 }],
          },
        ],
      });
      await createSession(accessToken, {
        date: '2026-01-15',
        exercises: [
          {
            exerciseType: 'BARBELL_BENCH_PRESS',
            sets: [
              { reps: 8, weightKg: 62.5 },
              { reps: 6, weightKg: 65 },
            ],
          },
        ],
      });

      const strangerToken = await newVerifiedUser('last-stranger');
      await createSession(strangerToken, {
        date: '2026-01-20',
        exercises: [
          {
            exerciseType: 'BARBELL_BENCH_PRESS',
            sets: [{ reps: 20, weightKg: 100 }],
          },
        ],
      });

      const res = await request(app.getHttpServer())
        .get('/workout-exercises/BARBELL_BENCH_PRESS/last')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const body = res.body as {
        loggedForDate: string;
        sets: { reps: number; weightKg: string | null }[];
      };
      expect(body.loggedForDate.slice(0, 10)).toBe('2026-01-15');
      const sets = body.sets;
      expect(sets).toHaveLength(2);
      expect(sets[0]).toMatchObject({ reps: 8 });
      expect(Number(sets[0].weightKg)).toBe(62.5);
      expect(sets[1]).toMatchObject({ reps: 6 });
      expect(Number(sets[1].weightKg)).toBe(65);
    });
  });

  describe('POST /workout-sessions', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post('/workout-sessions')
        .send({
          date: '2026-01-15',
          muscleGroups: ['CHEST'],
          exercises: [
            { exerciseType: 'BARBELL_BENCH_PRESS', sets: [{ reps: 10 }] },
          ],
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
          exercises: [
            { exerciseType: 'BARBELL_BENCH_PRESS', sets: [{ reps: 10 }] },
          ],
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
          exercises: [
            { exerciseType: 'BARBELL_BENCH_PRESS', sets: [{ reps: 0 }] },
          ],
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
            {
              exerciseType: 'BARBELL_BENCH_PRESS',
              sets: [{ reps: 10, weightKg: 60.123 }],
            },
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
          exercises: [
            { exerciseType: 'PUSH_UPS', sets: [{ reps: 20, weightKg: 0 }] },
          ],
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
          exercises: [
            { exerciseType: 'BARBELL_BENCH_PRESS', sets: [{ reps: 10 }] },
          ],
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
          exercises: [
            { exerciseType: 'BARBELL_BENCH_PRESS', sets: [{ reps: 10 }] },
          ],
        })
        .expect(400);
    });
  });

  describe('GET /workout-sessions', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer()).get('/workout-sessions').expect(401);
    });

    it('lists only the requesting user’s sessions, most recent loggedForDate first', async () => {
      const accessToken = await newVerifiedUser('list');
      const older = await createSession(accessToken, { date: '2026-01-10' });
      const newer = await createSession(accessToken, { date: '2026-01-20' });

      const strangerToken = await newVerifiedUser('list-stranger');
      await createSession(strangerToken, { date: '2026-01-25' });

      const res = await request(app.getHttpServer())
        .get('/workout-sessions')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const ids = (res.body as { id: string }[]).map((s) => s.id);
      expect(ids).toEqual([newer.id, older.id]);
    });

    it('filters by muscle group, pre-filtering each session’s exercises to only that group', async () => {
      const accessToken = await newVerifiedUser('filter');

      const mixed = await createSession(accessToken, {
        date: '2026-01-11',
        muscleGroups: ['CHEST', 'TRICEPS'],
        exercises: [
          {
            exerciseType: 'BARBELL_BENCH_PRESS',
            sets: [{ reps: 10, weightKg: 60 }],
          },
          {
            exerciseType: 'CABLE_TRICEPS_PUSHDOWN',
            sets: [{ reps: 12, weightKg: 20 }],
          },
        ],
      });
      await createSession(accessToken, {
        date: '2026-01-12',
        muscleGroups: ['LEGS'],
        exercises: [
          { exerciseType: 'BARBELL_SQUAT', sets: [{ reps: 5, weightKg: 100 }] },
        ],
      });

      const chestRes = await request(app.getHttpServer())
        .get('/workout-sessions')
        .query({ muscleGroup: 'CHEST' })
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const chestSessions = chestRes.body as {
        id: string;
        exercises: { exerciseType: string }[];
      }[];
      expect(chestSessions).toHaveLength(1);
      expect(chestSessions[0].id).toBe(mixed.id);
      // Pre-filtered: only the Chest exercise, the Triceps one is hidden.
      expect(chestSessions[0].exercises).toHaveLength(1);
      expect(chestSessions[0].exercises[0].exerciseType).toBe(
        'BARBELL_BENCH_PRESS',
      );

      const backRes = await request(app.getHttpServer())
        .get('/workout-sessions')
        .query({ muscleGroup: 'BACK' })
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(backRes.body).toEqual([]);

      const unfilteredRes = await request(app.getHttpServer())
        .get('/workout-sessions')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      const unfilteredMixed = (
        unfilteredRes.body as { id: string; exercises: unknown[] }[]
      ).find((s) => s.id === mixed.id);
      // Unfiltered: the full session, both exercises.
      expect(unfilteredMixed?.exercises).toHaveLength(2);
    });
  });

  describe('GET /workout-sessions/:id', () => {
    it('rejects an unauthenticated request', async () => {
      const accessToken = await newVerifiedUser('get-one-setup');
      const created = await createSession(accessToken);

      await request(app.getHttpServer())
        .get(`/workout-sessions/${created.id}`)
        .expect(401);
    });

    it('always returns every exercise, never a muscleGroup-filtered subset', async () => {
      const accessToken = await newVerifiedUser('get-one');

      const mixed = await createSession(accessToken, {
        muscleGroups: ['CHEST', 'TRICEPS'],
        exercises: [
          {
            exerciseType: 'BARBELL_BENCH_PRESS',
            sets: [{ reps: 10, weightKg: 60 }],
          },
          {
            exerciseType: 'CABLE_TRICEPS_PUSHDOWN',
            sets: [{ reps: 12, weightKg: 20 }],
          },
        ],
      });

      // Even after fetching this same session through a muscleGroup-filtered
      // list (which pre-filters exercises), the single-session lookup used
      // to reopen the edit form must return the full, unfiltered session.
      await request(app.getHttpServer())
        .get('/workout-sessions')
        .query({ muscleGroup: 'CHEST' })
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/workout-sessions/${mixed.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const exerciseTypes = (
        res.body.exercises as { exerciseType: string }[]
      ).map((e) => e.exerciseType);
      expect(exerciseTypes).toEqual([
        'BARBELL_BENCH_PRESS',
        'CABLE_TRICEPS_PUSHDOWN',
      ]);
    });

    it('returns 404 for another user’s session', async () => {
      const ownerToken = await newVerifiedUser('get-one-owner');
      const strangerToken = await newVerifiedUser('get-one-stranger');
      const created = await createSession(ownerToken);

      await request(app.getHttpServer())
        .get(`/workout-sessions/${created.id}`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(404);
    });
  });

  describe('PATCH /workout-sessions/:id', () => {
    it('fully replaces a session’s nested content', async () => {
      const accessToken = await newVerifiedUser('edit');
      const created = await createSession(accessToken, {
        muscleGroups: ['CHEST'],
        exercises: [
          {
            exerciseType: 'BARBELL_BENCH_PRESS',
            sets: [{ reps: 10, weightKg: 60 }],
          },
        ],
      });

      const res = await request(app.getHttpServer())
        .patch(`/workout-sessions/${created.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          date: '2026-01-16',
          muscleGroups: ['BACK', 'BICEPS'],
          exercises: [
            {
              exerciseType: 'LAT_PULLDOWN',
              sets: [{ reps: 12, weightKg: 45 }],
            },
            { exerciseType: 'BARBELL_CURL', sets: [{ reps: 10 }, { reps: 8 }] },
          ],
        })
        .expect(200);

      expect(res.body.id).toBe(created.id);
      expect(res.body.muscleGroups).toEqual(['BACK', 'BICEPS']);
      const exerciseTypes = (
        res.body.exercises as { exerciseType: string }[]
      ).map((e) => e.exerciseType);
      expect(exerciseTypes).toEqual(['LAT_PULLDOWN', 'BARBELL_CURL']);
    });

    it('rejects a future date', async () => {
      const accessToken = await newVerifiedUser('edit-future');
      const created = await createSession(accessToken);

      const tomorrow = new Date();
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

      await request(app.getHttpServer())
        .patch(`/workout-sessions/${created.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          date: tomorrow.toISOString().slice(0, 10),
          muscleGroups: ['CHEST'],
          exercises: [
            { exerciseType: 'BARBELL_BENCH_PRESS', sets: [{ reps: 10 }] },
          ],
        })
        .expect(400);
    });

    it('returns 404 for another user’s session', async () => {
      const ownerToken = await newVerifiedUser('edit-owner');
      const strangerToken = await newVerifiedUser('edit-stranger');
      const created = await createSession(ownerToken);

      await request(app.getHttpServer())
        .patch(`/workout-sessions/${created.id}`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({
          date: '2026-01-15',
          muscleGroups: ['CHEST'],
          exercises: [
            { exerciseType: 'BARBELL_BENCH_PRESS', sets: [{ reps: 10 }] },
          ],
        })
        .expect(404);
    });
  });

  describe('DELETE /workout-sessions/:id', () => {
    it('removes the session (cascading its exercises/sets); another user cannot delete it', async () => {
      const accessToken = await newVerifiedUser('delete');
      const created = await createSession(accessToken);

      const strangerToken = await newVerifiedUser('delete-stranger');
      await request(app.getHttpServer())
        .delete(`/workout-sessions/${created.id}`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .delete(`/workout-sessions/${created.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);

      const list = await request(app.getHttpServer())
        .get('/workout-sessions')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(list.body).toEqual([]);
    });
  });
});
