import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/modules/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CloudinaryService } from '../src/modules/users/cloudinary.service';
import { globalValidationPipe } from '../src/common/pipes/validation.pipe';

// Covers specs/008-sidebar-profile-account/contracts/account-settings-api.md:
// GET /profile/account, PATCH /profile/account, PATCH /profile/preferences,
// avatar upload/link/password routes.
describe('Account/Settings (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sentOtpEmails: { to: string; code: string }[] = [];
  const fakeCloudinary = {
    createUploadSignature: (userId: string) => ({
      cloudName: 'test-cloud',
      apiKey: 'test-key',
      timestamp: Math.floor(Date.now() / 1000),
      signature: 'fake-signature',
      folder: `avatars/u_${userId}`,
      uploadUrl: 'https://api.cloudinary.com/v1_1/test-cloud/image/upload',
    }),
    verifyUpload: (userId: string, publicId: string) => {
      if (!publicId.startsWith(`avatars/u_${userId}/`)) {
        // Mirrors the real CloudinaryService's contract: a folder mismatch
        // is a client error, not an unhandled failure.
        return Promise.reject(
          new BadRequestException(
            'Uploaded asset does not belong to this account.',
          ),
        );
      }
      return Promise.resolve();
    },
    destroyAsset: () => Promise.resolve(),
  };

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
      .overrideProvider(CloudinaryService)
      .useValue(fakeCloudinary)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(globalValidationPipe);
    await app.init();
    prisma = moduleFixture.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function newVerifiedUser(tag: string) {
    const email = `acct-${tag}-${Date.now()}${Math.floor(Math.random() * 1_000_000)}@example.com`;
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
    return body.accessToken;
  }

  async function newVerifiedUserWithId(tag: string) {
    const email = `acct-${tag}-${Date.now()}${Math.floor(Math.random() * 1_000_000)}@example.com`;
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

    const body = verifyRes.body as { accessToken: string; userId: string };
    return { accessToken: body.accessToken, userId: body.userId };
  }

  it('GET /profile/account returns default values for a fresh user', async () => {
    const accessToken = await newVerifiedUser('defaults');

    const res = await request(app.getHttpServer())
      .get('/profile/account')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body).toMatchObject({
      avatarUrl: null,
      unitsPreference: 'KG',
      languagePreference: 'en',
      appearancePreference: null,
      hasPassword: true,
      googleLinked: false,
    });
    const body = res.body as { displayName: string };
    expect(typeof body.displayName).toBe('string');
  });

  it('PATCH /profile/preferences updates only the fields provided', async () => {
    const accessToken = await newVerifiedUser('prefs');

    const unitsOnly = await request(app.getHttpServer())
      .patch('/profile/preferences')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ unitsPreference: 'LB' })
      .expect(200);

    const unitsBody = unitsOnly.body as {
      unitsPreference: string;
      languagePreference: string;
    };
    expect(unitsBody.unitsPreference).toBe('LB');
    expect(unitsBody.languagePreference).toBe('en');

    const appearanceOnly = await request(app.getHttpServer())
      .patch('/profile/preferences')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ appearancePreference: 'LIGHT' })
      .expect(200);

    const appearanceBody = appearanceOnly.body as {
      appearancePreference: string;
      unitsPreference: string;
    };
    expect(appearanceBody.appearancePreference).toBe('LIGHT');
    // Units set by the previous call must not have been reset.
    expect(appearanceBody.unitsPreference).toBe('LB');
  });

  it('PATCH /profile/preferences rejects an invalid enum value', async () => {
    const accessToken = await newVerifiedUser('invalid-prefs');

    await request(app.getHttpServer())
      .patch('/profile/preferences')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ unitsPreference: 'STONE' })
      .expect(400);
  });

  it('PATCH /profile/account updates the display name', async () => {
    const accessToken = await newVerifiedUser('display-name');

    const res = await request(app.getHttpServer())
      .patch('/profile/account')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ displayName: 'Jamie Rivera' })
      .expect(200);

    expect((res.body as { displayName: string }).displayName).toBe(
      'Jamie Rivera',
    );
  });

  it('PATCH /profile/account rejects an empty display name', async () => {
    const accessToken = await newVerifiedUser('display-name-invalid');

    await request(app.getHttpServer())
      .patch('/profile/account')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ displayName: '' })
      .expect(400);
  });

  it('Avatar upload flow: signature -> confirm -> remove', async () => {
    const { accessToken, userId } = await newVerifiedUserWithId('avatar');

    const signature = await request(app.getHttpServer())
      .post('/profile/avatar/upload-signature')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);

    const signatureBody = signature.body as { folder: string };
    expect(signatureBody.folder).toBe(`avatars/u_${userId}`);

    const confirmed = await request(app.getHttpServer())
      .patch('/profile/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        url: 'https://res.cloudinary.com/test-cloud/image/upload/v1/avatars/u_x/abc.jpg',
        publicId: `avatars/u_${userId}/abc`,
      })
      .expect(200);

    const confirmedBody = confirmed.body as { avatarUrl: string };
    expect(confirmedBody.avatarUrl).toContain('cloudinary.com');

    const afterGet = await request(app.getHttpServer())
      .get('/profile/account')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const afterGetBody = afterGet.body as { avatarUrl: string };
    expect(afterGetBody.avatarUrl).toBe(confirmedBody.avatarUrl);

    const removed = await request(app.getHttpServer())
      .delete('/profile/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect((removed.body as { avatarUrl: string | null }).avatarUrl).toBeNull();
  });

  it("PATCH /profile/avatar rejects an asset outside this user's folder", async () => {
    const { accessToken } = await newVerifiedUserWithId('avatar-mismatch');

    await request(app.getHttpServer())
      .patch('/profile/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        url: 'https://res.cloudinary.com/test-cloud/image/upload/v1/avatars/u_someone-else/abc.jpg',
        publicId: 'avatars/u_someone-else/abc',
      })
      .expect(400);
  });

  it('PATCH /profile/password changes the password when the current one is correct', async () => {
    const accessToken = await newVerifiedUser('change-pw');

    await request(app.getHttpServer())
      .patch('/profile/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        currentPassword: 'CorrectHorse123',
        newPassword: 'NewPassword456',
      })
      .expect(204);
  });

  it('PATCH /profile/password rejects an incorrect current password', async () => {
    const accessToken = await newVerifiedUser('change-pw-wrong');

    await request(app.getHttpServer())
      .patch('/profile/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'WrongPassword', newPassword: 'NewPassword456' })
      .expect(401);
  });

  it('POST /profile/password rejects setting a password when one already exists', async () => {
    const accessToken = await newVerifiedUser('set-pw-conflict');

    await request(app.getHttpServer())
      .post('/profile/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ newPassword: 'NewPassword456' })
      .expect(409);
  });

  it('PATCH /profile/password rejects a Google-only account with no password set', async () => {
    const { accessToken, userId } =
      await newVerifiedUserWithId('google-only-pw');
    // Simulate a Google-only account (no direct API path to create one in
    // tests without a real Google ID token — seed it via Prisma instead).
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: null },
    });

    await request(app.getHttpServer())
      .patch('/profile/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'anything', newPassword: 'NewPassword456' })
      .expect(401);
  });

  it('DELETE /profile/google/link is blocked when the account has no password', async () => {
    const { accessToken, userId } =
      await newVerifiedUserWithId('unlink-blocked');
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: null, googleSubjectId: `fake-subject-${userId}` },
    });

    await request(app.getHttpServer())
      .delete('/profile/google/link')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(409);
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/profile/account').expect(401);
  });
});
