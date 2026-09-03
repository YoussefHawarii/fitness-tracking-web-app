import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/modules/mail/mail.service';
import { globalValidationPipe } from '../src/common/pipes/validation.pipe';

// Covers specs/008-sidebar-profile-account/contracts/account-settings-api.md:
// POST /support/feedback.
describe('Support feedback (e2e)', () => {
  let app: INestApplication<App>;
  const sentOtpEmails: { to: string; code: string }[] = [];
  const sentFeedback: {
    fromUserEmail: string;
    subject: string;
    message: string;
  }[] = [];

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
        sendFeedbackEmail: (
          fromUserEmail: string,
          subject: string,
          message: string,
        ) => {
          sentFeedback.push({ fromUserEmail, subject, message });
          return Promise.resolve(true);
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(globalValidationPipe);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  async function newVerifiedUser(tag: string) {
    const email = `feedback-${tag}-${Date.now()}${Math.floor(Math.random() * 1_000_000)}@example.com`;
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

    const body = verifyRes.body as { accessToken: string };
    return { accessToken: body.accessToken, email };
  }

  it('sends a feedback message with the sender email attached', async () => {
    const { accessToken, email } = await newVerifiedUser('happy');

    await request(app.getHttpServer())
      .post('/support/feedback')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        subject: 'A great idea',
        message: 'Please add dark mode. Oh wait.',
      })
      .expect(202);

    const found = sentFeedback.find((f) => f.fromUserEmail === email);
    expect(found).toMatchObject({
      subject: 'A great idea',
      message: 'Please add dark mode. Oh wait.',
    });
  });

  it('rejects an empty subject or message', async () => {
    const { accessToken } = await newVerifiedUser('invalid');

    await request(app.getHttpServer())
      .post('/support/feedback')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ subject: '', message: 'hello' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/support/feedback')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ subject: 'hello', message: '' })
      .expect(400);
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer())
      .post('/support/feedback')
      .send({ subject: 'hello', message: 'hello' })
      .expect(401);
  });
});
