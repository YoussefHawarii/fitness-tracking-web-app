import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { MailService } from '../src/modules/mail/mail.service';

// Covers specs/002-jwt-auth-rate-limit/quickstart.md end-to-end: signup
// issues an access/refresh pair, refresh rotates it (and rejects reuse),
// logout revokes the refresh token, and the per-user rate limit trips.
//
// Since specs/003-email-otp-verification, signup no longer returns tokens
// directly — it emails a 6-digit OTP instead (verified via /auth/verify-otp).
// MailService is overridden here so the test can read the code without a
// real SMTP send.
describe('Auth (e2e)', () => {
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
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  async function signupAndVerify(email: string) {
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        username: `user${Date.now()}${Math.floor(Math.random() * 1000)}`,
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

    return verifyRes.body as { accessToken: string; refreshToken: string };
  }

  it('signup -> verify-otp -> refresh -> reuse rejected -> logout -> refresh rejected', async () => {
    const email = `e2e-${Date.now()}@example.com`;

    const { accessToken, refreshToken } = await signupAndVerify(email);
    expect(typeof accessToken).toBe('string');
    expect(typeof refreshToken).toBe('string');

    // FR-003: refresh exchanges a valid refresh token for a new pair.
    const refreshRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(201);
    const rotated = refreshRes.body as {
      accessToken: string;
      refreshToken: string;
    };
    expect(typeof rotated.accessToken).toBe('string');
    expect(typeof rotated.refreshToken).toBe('string');

    // FR-005: the just-rotated (now superseded) refresh token is rejected.
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(401);

    // FR-006: logout revokes the current refresh token.
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${rotated.accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: rotated.refreshToken })
      .expect(401);
  });

  it('rate-limits a single user to 50 requests per rolling 5-minute window', async () => {
    const email = `e2e-throttle-${Date.now()}@example.com`;
    const { accessToken } = await signupAndVerify(email);

    let lastStatus = 0;
    for (let i = 0; i < 50; i++) {
      const res = await request(app.getHttpServer())
        .get('/profile/account')
        .set('Authorization', `Bearer ${accessToken}`);
      lastStatus = res.status;
    }
    expect(lastStatus).not.toBe(429);

    const res = await request(app.getHttpServer())
      .get('/profile/account')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  }, 30_000);
});
