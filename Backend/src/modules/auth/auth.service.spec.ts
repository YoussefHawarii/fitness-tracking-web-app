import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

// Covers FR-005: refreshTokens() must reject expired, revoked,
// already-rotated (mismatched hash), and malformed/unverifiable refresh
// tokens, and must otherwise rotate (revoke old, issue new) on success.
describe('AuthService.refreshTokens', () => {
  const userId = 'user-1';
  const email = 'user@example.com';
  const jti = 'refresh-row-1';

  function buildService(overrides: {
    verify?: () => unknown;
    findUnique?: () => unknown;
  }): {
    service: AuthService;
    prisma: {
      refreshToken: {
        findUnique: jest.Mock;
        update: jest.Mock<
          unknown,
          [{ where: { id: string }; data: { revokedAt: Date } }]
        >;
        create: jest.Mock;
      };
    };
    refreshJwtService: { verify: jest.Mock; sign: jest.Mock };
  } {
    const prisma = {
      refreshToken: {
        findUnique: jest.fn(overrides.findUnique ?? (() => null)),
        update: jest.fn(),
        create: jest.fn(),
      },
    };
    // Access-token JwtService — only exercised indirectly, when a test
    // reaches the success path and issueTokenPair() signs a new access
    // token alongside the refresh token.
    const jwtService = {
      verify: jest.fn(),
      sign: jest.fn(() => 'signed.access.token'),
    };
    // Refresh-token JwtService — what refreshTokens() actually verifies
    // and issueRefreshToken() actually signs with, per auth.module.ts's
    // split access/refresh secrets.
    const refreshJwtService = {
      verify: jest.fn(
        overrides.verify ?? (() => ({ sub: userId, email, jti })),
      ),
      sign: jest.fn(() => 'signed.refresh.token'),
    };
    const configService = { get: jest.fn(() => 'config-value') };
    const mailService = {
      sendOtpEmail: jest.fn(),
      sendWelcomeEmail: jest.fn(),
    };

    const service = new AuthService(
      prisma as unknown as ConstructorParameters<typeof AuthService>[0],
      jwtService as unknown as ConstructorParameters<typeof AuthService>[1],
      configService as unknown as ConstructorParameters<typeof AuthService>[2],
      mailService as unknown as ConstructorParameters<typeof AuthService>[3],
      refreshJwtService as unknown as ConstructorParameters<
        typeof AuthService
      >[4],
    );

    return { service, prisma, refreshJwtService };
  }

  it('rejects a malformed/unverifiable refresh token', async () => {
    const { service } = buildService({
      verify: () => {
        throw new Error('bad signature');
      },
    });

    await expect(
      service.refreshTokens({ refreshToken: 'garbage' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects when no matching RefreshToken row exists', async () => {
    const { service } = buildService({ findUnique: () => null });

    await expect(
      service.refreshTokens({ refreshToken: 'some.jwt.token' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an already-revoked (reused/rotated) refresh token', async () => {
    const { service } = buildService({
      findUnique: () => ({
        id: jti,
        userId,
        tokenHash: hashOf('some.jwt.token'),
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: new Date(), // already used/logged out
      }),
    });

    await expect(
      service.refreshTokens({ refreshToken: 'some.jwt.token' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an expired refresh token row', async () => {
    const { service } = buildService({
      findUnique: () => ({
        id: jti,
        userId,
        tokenHash: hashOf('some.jwt.token'),
        expiresAt: new Date(Date.now() - 1), // already past expiry
        revokedAt: null,
      }),
    });

    await expect(
      service.refreshTokens({ refreshToken: 'some.jwt.token' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects when the stored hash does not match the presented token', async () => {
    const { service } = buildService({
      findUnique: () => ({
        id: jti,
        userId,
        tokenHash: hashOf('a-different-token'),
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
      }),
    });

    await expect(
      service.refreshTokens({ refreshToken: 'some.jwt.token' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rotates on success: revokes the old row and issues a new pair', async () => {
    const presented = 'some.jwt.token';
    const { service, prisma } = buildService({
      findUnique: () => ({
        id: jti,
        userId,
        tokenHash: hashOf(presented),
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
      }),
    });

    const result: { accessToken: string; refreshToken: string } =
      await service.refreshTokens({ refreshToken: presented });

    const [updateCall] = prisma.refreshToken.update.mock.calls[0];
    expect(updateCall.where).toEqual({ id: jti });
    expect(updateCall.data.revokedAt).toBeInstanceOf(Date);
    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);

    expect(typeof result.accessToken).toBe('string');
    expect(typeof result.refreshToken).toBe('string');
  });
});

// Covers specs/003-email-otp-verification FR-001 through FR-004: signup no
// longer issues a session directly — it reserves the username, creates/
// reuses a pending unverified user, stores a hashed 6-digit OTP, and emails
// it.
describe('AuthService.signup (OTP)', () => {
  function build(
    overrides: {
      findUniqueUser?: (args: { where: Record<string, unknown> }) => unknown;
      createUser?: (args: { data: Record<string, unknown> }) => unknown;
      updateUser?: (args: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => unknown;
      sendOtpEmail?: jest.Mock;
    } = {},
  ) {
    const prisma = {
      user: {
        findUnique: jest.fn(overrides.findUniqueUser ?? (() => null)),
        create: jest.fn(
          overrides.createUser ??
            ((args: { data: Record<string, unknown> }) => ({
              id: 'new-user',
              email: args.data.email,
              emailVerified: false,
            })),
        ),
        update: jest.fn(
          overrides.updateUser ??
            ((args: {
              where: { id: string };
              data: Record<string, unknown>;
            }) => ({
              id: args.where.id,
              email: 'pending@example.com',
              emailVerified: false,
            })),
        ),
      },
      otpCode: {
        upsert: jest.fn(() => ({})),
      },
    };
    const mailService = {
      sendOtpEmail: overrides.sendOtpEmail ?? jest.fn(),
      sendWelcomeEmail: jest.fn(),
    };
    const jwtService = { sign: jest.fn(() => 'signed.access.token') };
    const configService = { get: jest.fn(() => 'config-value') };
    const refreshJwtService = { sign: jest.fn(() => 'signed.refresh.token') };

    const service = new AuthService(
      prisma as unknown as ConstructorParameters<typeof AuthService>[0],
      jwtService as unknown as ConstructorParameters<typeof AuthService>[1],
      configService as unknown as ConstructorParameters<typeof AuthService>[2],
      mailService as unknown as ConstructorParameters<typeof AuthService>[3],
      refreshJwtService as unknown as ConstructorParameters<
        typeof AuthService
      >[4],
    );

    return { service, prisma, mailService };
  }

  it('creates a pending user, stores a hashed OTP, emails it, and returns no tokens', async () => {
    const { service, prisma, mailService } = build();

    const result = await service.signup({
      username: 'newuser',
      email: 'new@example.com',
      password: 'password123',
      timezone: 'UTC',
    });

    expect(result).toEqual({ email: 'new@example.com', otpRequested: true });
    expect(result).not.toHaveProperty('accessToken');
    expect(prisma.otpCode.upsert).toHaveBeenCalledTimes(1);
    expect(mailService.sendOtpEmail).toHaveBeenCalledTimes(1);
  });

  it('rejects when the username is already taken by a different user', async () => {
    const { service } = build({
      findUniqueUser: (args) =>
        'username' in args.where
          ? { id: 'other-user', emailVerified: false }
          : null,
    });

    await expect(
      service.signup({
        username: 'taken',
        email: 'a@example.com',
        password: 'password123',
        timezone: 'UTC',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects when the email already belongs to a verified account', async () => {
    const { service } = build({
      findUniqueUser: (args) =>
        'email' in args.where
          ? { id: 'verified-user', emailVerified: true }
          : null,
    });

    await expect(
      service.signup({
        username: 'newname',
        email: 'verified@example.com',
        password: 'password123',
        timezone: 'UTC',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('reuses a pending unverified account for the same email instead of erroring', async () => {
    const pendingUser = { id: 'pending-user', emailVerified: false };
    const { service, prisma } = build({
      findUniqueUser: (args) => ('email' in args.where ? pendingUser : null),
    });

    const result = await service.signup({
      username: 'newname',
      email: 'pending@example.com',
      password: 'password123',
      timezone: 'UTC',
    });

    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(result.otpRequested).toBe(true);
  });

  it('surfaces a BadGatewayException when the OTP email fails to send', async () => {
    const { service } = build({
      sendOtpEmail: jest.fn(() => Promise.reject(new Error('smtp down'))),
    });

    await expect(
      service.signup({
        username: 'newuser',
        email: 'new2@example.com',
        password: 'password123',
        timezone: 'UTC',
      }),
    ).rejects.toThrow(BadGatewayException);
  });
});

// Covers FR-005, FR-009, FR-011, FR-015: verifyOtp() must accept only a
// correct, unexpired code, track/lock out wrong attempts, and only then
// issue a session.
describe('AuthService.verifyOtp', () => {
  const userId = 'user-1';
  const email = 'user@example.com';

  function build(
    overrides: {
      findOtp?: () => unknown;
      otpUpdate?: jest.Mock;
      otpDelete?: jest.Mock;
    } = {},
  ) {
    const prisma = {
      user: {
        findUnique: jest.fn(() => ({
          id: userId,
          email,
          emailVerified: false,
        })),
        update: jest.fn(() => ({ id: userId, email, emailVerified: true })),
      },
      otpCode: {
        findUnique: jest.fn(overrides.findOtp ?? (() => null)),
        update: overrides.otpUpdate ?? jest.fn(),
        delete: overrides.otpDelete ?? jest.fn(),
      },
      refreshToken: { create: jest.fn() },
    };
    const jwtService = { sign: jest.fn(() => 'signed.access.token') };
    const refreshJwtService = { sign: jest.fn(() => 'signed.refresh.token') };
    const configService = { get: jest.fn(() => 'config-value') };
    const mailService = {
      sendOtpEmail: jest.fn(),
      sendWelcomeEmail: jest.fn(),
    };

    const service = new AuthService(
      prisma as unknown as ConstructorParameters<typeof AuthService>[0],
      jwtService as unknown as ConstructorParameters<typeof AuthService>[1],
      configService as unknown as ConstructorParameters<typeof AuthService>[2],
      mailService as unknown as ConstructorParameters<typeof AuthService>[3],
      refreshJwtService as unknown as ConstructorParameters<
        typeof AuthService
      >[4],
    );

    return { service, prisma, mailService };
  }

  it('rejects when there is no active OTP for the account', async () => {
    const { service } = build({ findOtp: () => null });

    await expect(service.verifyOtp({ email, code: '123456' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects and deletes an expired code', async () => {
    const otpDelete = jest.fn();
    const { service } = build({
      findOtp: () => ({
        id: 'otp-1',
        codeHash: 'irrelevant',
        expiresAt: new Date(Date.now() - 1000),
        attemptCount: 0,
      }),
      otpDelete,
    });

    await expect(service.verifyOtp({ email, code: '123456' })).rejects.toThrow(
      UnauthorizedException,
    );
    expect(otpDelete).toHaveBeenCalledTimes(1);
  });

  it('rejects a wrong code and increments the attempt count', async () => {
    const codeHash = await bcrypt.hash('654321', 10);
    const otpUpdate = jest.fn();
    const { service } = build({
      findOtp: () => ({
        id: 'otp-1',
        codeHash,
        expiresAt: new Date(Date.now() + 60_000),
        attemptCount: 0,
      }),
      otpUpdate,
    });

    await expect(service.verifyOtp({ email, code: '123456' })).rejects.toThrow(
      UnauthorizedException,
    );
    expect(otpUpdate).toHaveBeenCalledWith({
      where: { id: 'otp-1' },
      data: { attemptCount: 1 },
    });
  });

  it('locks out and deletes the code after the 5th wrong attempt', async () => {
    const codeHash = await bcrypt.hash('654321', 10);
    const otpDelete = jest.fn();
    const { service } = build({
      findOtp: () => ({
        id: 'otp-1',
        codeHash,
        expiresAt: new Date(Date.now() + 60_000),
        attemptCount: 4,
      }),
      otpDelete,
    });

    await expect(service.verifyOtp({ email, code: '123456' })).rejects.toThrow(
      UnauthorizedException,
    );
    expect(otpDelete).toHaveBeenCalledTimes(1);
  });

  it('verifies the account, deletes the code, sends a welcome email, and issues a session on a correct code', async () => {
    const codeHash = await bcrypt.hash('123456', 10);
    const otpDelete = jest.fn();
    const { service, mailService } = build({
      findOtp: () => ({
        id: 'otp-1',
        codeHash,
        expiresAt: new Date(Date.now() + 60_000),
        attemptCount: 0,
      }),
      otpDelete,
    });

    const result = await service.verifyOtp({ email, code: '123456' });

    expect(otpDelete).toHaveBeenCalledTimes(1);
    expect(result.emailVerified).toBe(true);
    expect(typeof result.accessToken).toBe('string');
    expect(typeof result.refreshToken).toBe('string');
    expect(mailService.sendWelcomeEmail).toHaveBeenCalledWith(email);
  });
});

// Covers FR-014: an unverified account must not be able to sign in directly.
describe('AuthService.login (email verification gate)', () => {
  it('rejects with ForbiddenException when the account is not yet verified', async () => {
    const passwordHash = await bcrypt.hash('password123', 10);
    const prisma = {
      user: {
        findUnique: jest.fn(() => ({
          id: 'user-1',
          email: 'user@example.com',
          passwordHash,
          emailVerified: false,
        })),
      },
    };
    const jwtService = { sign: jest.fn() };
    const configService = { get: jest.fn(() => 'config-value') };
    const mailService = {
      sendOtpEmail: jest.fn(),
      sendWelcomeEmail: jest.fn(),
    };
    const refreshJwtService = { sign: jest.fn() };

    const service = new AuthService(
      prisma as unknown as ConstructorParameters<typeof AuthService>[0],
      jwtService as unknown as ConstructorParameters<typeof AuthService>[1],
      configService as unknown as ConstructorParameters<typeof AuthService>[2],
      mailService as unknown as ConstructorParameters<typeof AuthService>[3],
      refreshJwtService as unknown as ConstructorParameters<
        typeof AuthService
      >[4],
    );

    await expect(
      service.login({ email: 'user@example.com', password: 'password123' }),
    ).rejects.toThrow(ForbiddenException);
  });
});

// Covers FR-010, FR-016: resendOtp() replaces the code and resets attempts,
// subject to a 60s cooldown; the scheduled sweep deletes rows past expiry.
describe('AuthService.resendOtp', () => {
  const email = 'user@example.com';

  function build(
    overrides: {
      findUser?: () => unknown;
      findOtp?: () => unknown;
      upsert?: jest.Mock;
      sendOtpEmail?: jest.Mock;
    } = {},
  ) {
    const prisma = {
      user: {
        findUnique: jest.fn(
          overrides.findUser ??
            (() => ({ id: 'user-1', email, emailVerified: false })),
        ),
      },
      otpCode: {
        findUnique: jest.fn(overrides.findOtp ?? (() => null)),
        upsert: overrides.upsert ?? jest.fn(() => ({})),
      },
    };
    const jwtService = { sign: jest.fn() };
    const configService = { get: jest.fn(() => 'config-value') };
    const mailService = {
      sendOtpEmail: overrides.sendOtpEmail ?? jest.fn(),
      sendWelcomeEmail: jest.fn(),
    };
    const refreshJwtService = { sign: jest.fn() };

    const service = new AuthService(
      prisma as unknown as ConstructorParameters<typeof AuthService>[0],
      jwtService as unknown as ConstructorParameters<typeof AuthService>[1],
      configService as unknown as ConstructorParameters<typeof AuthService>[2],
      mailService as unknown as ConstructorParameters<typeof AuthService>[3],
      refreshJwtService as unknown as ConstructorParameters<
        typeof AuthService
      >[4],
    );

    return { service, prisma, mailService };
  }

  it('issues a fresh code (resetting attemptCount) when no cooldown applies', async () => {
    const { service, prisma, mailService } = build({
      findOtp: () => ({
        id: 'otp-1',
        attemptCount: 3,
        lastSentAt: new Date(Date.now() - 61_000),
      }),
    });

    const result = await service.resendOtp({ email });

    expect(result).toEqual({ otpRequested: true });
    expect(prisma.otpCode.upsert).toHaveBeenCalledTimes(1);
    const [[upsertArgs]] = prisma.otpCode.upsert.mock.calls as [
      [{ update: { attemptCount: number } }],
    ];
    expect(upsertArgs.update.attemptCount).toBe(0);
    expect(mailService.sendOtpEmail).toHaveBeenCalledTimes(1);
  });

  it('rejects with a 429 when requested again inside the 60s cooldown', async () => {
    const { service } = build({
      findOtp: () => ({
        id: 'otp-1',
        attemptCount: 0,
        lastSentAt: new Date(Date.now() - 5_000),
      }),
    });

    await expect(service.resendOtp({ email })).rejects.toMatchObject({
      status: 429,
    });
  });

  it('responds generically without sending mail when the email has no pending account', async () => {
    const { service, mailService } = build({
      findUser: () => null,
    });

    const result = await service.resendOtp({ email: 'nobody@example.com' });

    expect(result).toEqual({ otpRequested: true });
    expect(mailService.sendOtpEmail).not.toHaveBeenCalled();
  });
});

// Covers FR-016: expired OtpCode rows are actually deleted, independent of
// any user interaction.
describe('AuthService.cleanupExpiredOtpCodes', () => {
  it('deletes every OtpCode row past its expiresAt', async () => {
    const deleteMany = jest.fn();
    const prisma = { otpCode: { deleteMany } };
    const jwtService = { sign: jest.fn() };
    const configService = { get: jest.fn(() => 'config-value') };
    const mailService = {
      sendOtpEmail: jest.fn(),
      sendWelcomeEmail: jest.fn(),
    };
    const refreshJwtService = { sign: jest.fn() };

    const service = new AuthService(
      prisma as unknown as ConstructorParameters<typeof AuthService>[0],
      jwtService as unknown as ConstructorParameters<typeof AuthService>[1],
      configService as unknown as ConstructorParameters<typeof AuthService>[2],
      mailService as unknown as ConstructorParameters<typeof AuthService>[3],
      refreshJwtService as unknown as ConstructorParameters<
        typeof AuthService
      >[4],
    );

    await service.cleanupExpiredOtpCodes();

    expect(deleteMany).toHaveBeenCalledTimes(1);
    const [[args]] = deleteMany.mock.calls as [
      [{ where: { expiresAt: { lt: Date } } }],
    ];
    expect(args.where.expiresAt.lt).toBeInstanceOf(Date);
  });
});

function hashOf(token: string): string {
  // Mirrors AuthService's private hashToken() (SHA-256 hex) without
  // exporting it — keeps the helper an implementation detail of the module.
  return crypto.createHash('sha256').update(token).digest('hex');
}
