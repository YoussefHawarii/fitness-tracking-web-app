import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/modules/mail/mail.service';
import { globalValidationPipe } from '../src/common/pipes/validation.pipe';

// Covers specs/009-workout-tracking (issue #4) ticket #5:
// GET /workout-exercises.
describe('Workout exercises (e2e)', () => {
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

  it('rejects an unauthenticated request', async () => {
    await request(app.getHttpServer()).get('/workout-exercises').expect(401);
  });

  it('GET /workout-exercises returns the fixed catalog, covering every muscle group', async () => {
    const email = `workout-catalog-${Date.now()}@example.com`;
    const { accessToken } = await signupAndVerify(email);

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
