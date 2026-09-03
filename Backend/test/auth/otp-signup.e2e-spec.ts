import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { MailService } from '../../src/modules/mail/mail.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { OtpPurpose } from '@prisma/client';

// Covers specs/003-email-otp-verification acceptance scenarios and edge
// cases beyond the happy path already exercised in test/auth.e2e-spec.ts:
// wrong-code retry, attempt lockout, expiry + TTL deletion, resend +
// cooldown, duplicate username/email, pending-account re-signup, and the
// login block on unverified accounts.
describe('Auth OTP signup verification (e2e)', () => {
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
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  function uniqueUser(tag: string) {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;
    return {
      username: `u${tag}${stamp}`,
      email: `otp-${tag}-${stamp}@example.com`,
      password: 'CorrectHorse123',
      timezone: 'UTC',
    };
  }

  function lastCodeFor(email: string): string {
    const sent = sentOtpEmails.filter((e) => e.to === email).pop();
    if (!sent) throw new Error(`No OTP email captured for ${email}`);
    return sent.code;
  }

  it('signup does not grant a session; verify-otp with the correct code does', async () => {
    const user = uniqueUser('happy');

    const signupRes = await request(app.getHttpServer())
      .post('/auth/signup')
      .send(user)
      .expect(201);
    expect(signupRes.body).toEqual({ email: user.email, otpRequested: true });
    expect(signupRes.body).not.toHaveProperty('accessToken');

    const code = lastCodeFor(user.email);
    const verifyRes = await request(app.getHttpServer())
      .post('/auth/verify-otp')
      .send({ email: user.email, code })
      .expect(201);
    expect(typeof (verifyRes.body as { accessToken: string }).accessToken).toBe(
      'string',
    );
    expect((verifyRes.body as { emailVerified: boolean }).emailVerified).toBe(
      true,
    );
  });

  it('rejects a wrong code and allows retrying with the correct one', async () => {
    const user = uniqueUser('wrong');
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send(user)
      .expect(201);
    const code = lastCodeFor(user.email);
    const wrongCode = code === '000000' ? '111111' : '000000';

    await request(app.getHttpServer())
      .post('/auth/verify-otp')
      .send({ email: user.email, code: wrongCode })
      .expect(401);

    await request(app.getHttpServer())
      .post('/auth/verify-otp')
      .send({ email: user.email, code })
      .expect(201);
  });

  it('locks out the code after 5 wrong attempts', async () => {
    const user = uniqueUser('lockout');
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send(user)
      .expect(201);
    const code = lastCodeFor(user.email);
    const wrongCode = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post('/auth/verify-otp')
        .send({ email: user.email, code: wrongCode })
        .expect(401);
    }

    // Even the originally-correct code is now rejected — the row is gone.
    await request(app.getHttpServer())
      .post('/auth/verify-otp')
      .send({ email: user.email, code })
      .expect(401);
  });

  it('rejects an expired code and deletes it from storage (FR-009, FR-016)', async () => {
    const user = uniqueUser('expired');
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send(user)
      .expect(201);
    const code = lastCodeFor(user.email);

    const dbUser = await prisma.user.findUniqueOrThrow({
      where: { email: user.email },
    });
    await prisma.otpCode.update({
      where: {
        userId_purpose: {
          userId: dbUser.id,
          purpose: OtpPurpose.SIGNUP_VERIFICATION,
        },
      },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await request(app.getHttpServer())
      .post('/auth/verify-otp')
      .send({ email: user.email, code })
      .expect(401);

    const remaining = await prisma.otpCode.findUnique({
      where: {
        userId_purpose: {
          userId: dbUser.id,
          purpose: OtpPurpose.SIGNUP_VERIFICATION,
        },
      },
    });
    expect(remaining).toBeNull();
  });

  it('resend issues a working new code and rejects the old one', async () => {
    const user = uniqueUser('resend');
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send(user)
      .expect(201);
    const oldCode = lastCodeFor(user.email);

    const dbUser = await prisma.user.findUniqueOrThrow({
      where: { email: user.email },
    });
    // Bypass the 60s cooldown for this test by backdating lastSentAt.
    await prisma.otpCode.update({
      where: {
        userId_purpose: {
          userId: dbUser.id,
          purpose: OtpPurpose.SIGNUP_VERIFICATION,
        },
      },
      data: { lastSentAt: new Date(Date.now() - 61_000) },
    });

    await request(app.getHttpServer())
      .post('/auth/resend-otp')
      .send({ email: user.email })
      .expect(201);
    const newCode = lastCodeFor(user.email);

    await request(app.getHttpServer())
      .post('/auth/verify-otp')
      .send({ email: user.email, code: oldCode })
      .expect(401);

    await request(app.getHttpServer())
      .post('/auth/verify-otp')
      .send({ email: user.email, code: newCode })
      .expect(201);
  });

  it('rejects a resend within the 60s cooldown', async () => {
    const user = uniqueUser('cooldown');
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send(user)
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/auth/resend-otp')
      .send({ email: user.email });
    expect(res.status).toBe(429);
  });

  it('rejects signup with a username that is already taken', async () => {
    const user = uniqueUser('uname');
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send(user)
      .expect(201);

    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ ...uniqueUser('uname-other'), username: user.username })
      .expect(409);
  });

  it('rejects signup with an email that already belongs to a verified account', async () => {
    const user = uniqueUser('verifiedemail');
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send(user)
      .expect(201);
    const code = lastCodeFor(user.email);
    await request(app.getHttpServer())
      .post('/auth/verify-otp')
      .send({ email: user.email, code })
      .expect(201);

    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ ...uniqueUser('verifiedemail-2'), email: user.email })
      .expect(409);
  });

  it('re-signing up against a pending unverified email reuses the account and sends a fresh code', async () => {
    const user = uniqueUser('pending');
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send(user)
      .expect(201);
    const firstCode = lastCodeFor(user.email);

    const secondAttempt = uniqueUser('pending-2');
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ ...secondAttempt, email: user.email })
      .expect(201);
    const secondCode = lastCodeFor(user.email);

    const usersWithEmail = await prisma.user.findMany({
      where: { email: user.email },
    });
    expect(usersWithEmail).toHaveLength(1);

    // The first code was replaced — only the second is valid now.
    if (firstCode !== secondCode) {
      await request(app.getHttpServer())
        .post('/auth/verify-otp')
        .send({ email: user.email, code: firstCode })
        .expect(401);
    }
    await request(app.getHttpServer())
      .post('/auth/verify-otp')
      .send({ email: user.email, code: secondCode })
      .expect(201);
  });

  it('blocks login on an unverified account (FR-014)', async () => {
    const user = uniqueUser('blocked');
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send(user)
      .expect(201);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(403);
  });
});
