import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { MailService } from '../src/modules/mail/mail.service';
import { globalValidationPipe } from '../src/common/pipes/validation.pipe';

// Weight fields should accept any decimal precision up to 2 places (e.g.
// 75.5, 75.55) but reject finer precision, negatives, and non-numeric values.
describe('Weight decimal validation (e2e)', () => {
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

  function onboardingPayload(overrides: Record<string, unknown> = {}) {
    return {
      age: 30,
      sex: 'MALE',
      heightCm: 180,
      currentWeightKg: 80,
      goalWeightKg: 75,
      activityLevel: 'LIGHTLY_ACTIVE',
      timezone: 'UTC',
      ...overrides,
    };
  }

  it('POST /onboarding accepts a decimal weight with up to 2 places', async () => {
    const email = `wdec-ok-${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;
    const { accessToken } = await signupAndVerify(email);

    await request(app.getHttpServer())
      .post('/onboarding')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(onboardingPayload({ currentWeightKg: 75.55, goalWeightKg: 70.5 }))
      .expect(201);
  });

  it('POST /onboarding rejects a weight with more than 2 decimal places', async () => {
    const email = `wdec-bad-${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;
    const { accessToken } = await signupAndVerify(email);

    await request(app.getHttpServer())
      .post('/onboarding')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(onboardingPayload({ currentWeightKg: 75.333 }))
      .expect(400);
  });

  it('POST /onboarding rejects a negative weight', async () => {
    const email = `wdec-neg-${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;
    const { accessToken } = await signupAndVerify(email);

    await request(app.getHttpServer())
      .post('/onboarding')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(onboardingPayload({ currentWeightKg: -75.5 }))
      .expect(400);
  });

  it('POST /onboarding rejects a non-numeric weight', async () => {
    const email = `wdec-nan-${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;
    const { accessToken } = await signupAndVerify(email);

    await request(app.getHttpServer())
      .post('/onboarding')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(onboardingPayload({ currentWeightKg: 'seventy-five' }))
      .expect(400);
  });

  it('POST /weigh-ins accepts a 2-decimal weight and rejects finer precision or negatives', async () => {
    const email = `wdec-weighin-${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;
    const { accessToken } = await signupAndVerify(email);
    await request(app.getHttpServer())
      .post('/onboarding')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(onboardingPayload())
      .expect(201);

    await request(app.getHttpServer())
      .post('/weigh-ins')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ weightKg: 79.55, date: '2026-01-01' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/weigh-ins')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ weightKg: 79.555, date: '2026-01-02' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/weigh-ins')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ weightKg: -79.5, date: '2026-01-03' })
      .expect(400);
  });
});
