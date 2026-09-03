import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { OtpPurpose } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { REFRESH_JWT_SERVICE } from './keys';

const BCRYPT_SALT_ROUNDS = 10;
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days, FR-002

// Email OTP signup verification (specs/003-email-otp-verification):
const OTP_TTL_MS = 5 * 60 * 1000; // FR-009 — exactly 5 minutes
const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // FR-010
const OTP_MAX_ATTEMPTS = 5; // FR-015

function generateOtpCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

@Injectable()
export class AuthService {
  private readonly googleClient: OAuth2Client;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService, // access-token secret
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    @Inject(REFRESH_JWT_SERVICE)
    private readonly refreshJwtService: JwtService, // refresh-token secret
  ) {
    this.googleClient = new OAuth2Client(
      this.configService.get<string>('GOOGLE_CLIENT_ID'),
    );
  }

  // Fixed 30-minute expiry from AuthModule's JwtModule signOptions — never
  // extended by activity (FR-001, FR-012).
  private issueAccessToken(user: { id: string; email: string }) {
    return this.jwtService.sign({ sub: user.id, email: user.email });
  }

  // Issues a 7-day refresh JWT and persists its revocable DB counterpart
  // (hash only, never the raw token — mirrors passwordHash treatment).
  // See specs/002-jwt-auth-rate-limit/data-model.md.
  private async issueRefreshToken(user: { id: string; email: string }) {
    const jti = crypto.randomUUID();
    const refreshToken = this.refreshJwtService.sign(
      { sub: user.id, email: user.email, jti },
      { expiresIn: `${REFRESH_TOKEN_TTL_SECONDS}s` },
    );

    await this.prisma.refreshToken.create({
      data: {
        id: jti,
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      },
    });

    return refreshToken;
  }

  private async issueTokenPair(user: { id: string; email: string }) {
    const accessToken = this.issueAccessToken(user);
    const refreshToken = await this.issueRefreshToken(user);
    return { accessToken, refreshToken };
  }

  // Email/password signup no longer grants a session directly (spec 003,
  // FR-004) — it creates/reuses a pending, unverified account and emails a
  // 6-digit OTP instead. A session is only issued once verifyOtp succeeds.
  async signup(dto: SignupDto) {
    const existingByEmail = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existingByEmail?.emailVerified) {
      throw new ConflictException('An account with this email already exists.');
    }

    // Username must be unique, but a pending account resubmitting the same
    // username it already holds is not a conflict with itself (FR-002).
    const usernameOwner = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (usernameOwner && usernameOwner.id !== existingByEmail?.id) {
      throw new ConflictException('This username is already taken.');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS);

    // Re-signing up against an existing *unverified* account reuses that
    // row and issues a fresh OTP, rather than erroring (spec Edge Cases).
    const user = existingByEmail
      ? await this.prisma.user.update({
          where: { id: existingByEmail.id },
          data: {
            username: dto.username,
            passwordHash,
            timezone: dto.timezone,
          },
        })
      : await this.prisma.user.create({
          data: {
            username: dto.username,
            email: dto.email,
            passwordHash,
            timezone: dto.timezone,
          },
        });

    await this.issueAndSendOtp(user.id, user.email);

    return { email: user.email, otpRequested: true };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user?.passwordHash) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    // Only ever reached with correct credentials, so this never confirms an
    // unverified account's existence to someone guessing passwords (FR-014).
    if (!user.emailVerified) {
      throw new ForbiddenException(
        'Please verify your email before logging in.',
      );
    }

    const { accessToken, refreshToken } = await this.issueTokenPair(user);
    const hasBaseline = await this.userHasBaseline(user.id);
    return { accessToken, refreshToken, userId: user.id, hasBaseline };
  }

  // Lets callers that issue a session (login, googleLogin) tell the frontend
  // whether this account still needs to go through onboarding — a signal
  // that doesn't come from emailVerified/session state alone, since Google
  // sign-in verifies email ownership itself but never runs the onboarding
  // step (specs/001-calorie-weight-tracking) the way the OTP flow does.
  private async userHasBaseline(userId: string): Promise<boolean> {
    const baseline = await this.prisma.userBaseline.findUnique({
      where: { userId },
    });
    return baseline !== null;
  }

  // Shared by signup() and resendOtp(): (re)generates a 6-digit code, hashes
  // it, replaces this user's OtpCode row (resets attemptCount — FR-010), and
  // emails it. Throws BadGatewayException if the email can't be sent so the
  // caller sees an actionable error rather than a false "code sent".
  private async issueAndSendOtp(userId: string, email: string) {
    const code = generateOtpCode();
    const codeHash = await bcrypt.hash(code, BCRYPT_SALT_ROUNDS);
    const now = new Date();

    await this.prisma.otpCode.upsert({
      where: {
        userId_purpose: { userId, purpose: OtpPurpose.SIGNUP_VERIFICATION },
      },
      create: {
        userId,
        purpose: OtpPurpose.SIGNUP_VERIFICATION,
        codeHash,
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
        attemptCount: 0,
        lastSentAt: now,
      },
      update: {
        codeHash,
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
        attemptCount: 0,
        lastSentAt: now,
      },
    });

    try {
      await this.mailService.sendOtpEmail(email, code);
    } catch {
      throw new BadGatewayException(
        'Could not send the verification email. Please try again.',
      );
    }
  }

  // Checks a submitted 6-digit code against the stored, hashed OTP (FR-005,
  // FR-009, FR-015). On success: deletes the OtpCode row, verifies the
  // account, issues a session, and fires the (best-effort) welcome email
  // (FR-011 through FR-013). On failure: tracks/locks out attempts and
  // throws a generic error, granting no session.
  async verifyOtp(dto: VerifyOtpDto) {
    const genericError = () =>
      new UnauthorizedException(
        'Invalid or expired code. Please request a new one.',
      );

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) {
      throw genericError();
    }

    const otpCode = await this.prisma.otpCode.findUnique({
      where: {
        userId_purpose: {
          userId: user.id,
          purpose: OtpPurpose.SIGNUP_VERIFICATION,
        },
      },
    });
    if (!otpCode) {
      throw genericError();
    }

    if (otpCode.expiresAt <= new Date()) {
      await this.prisma.otpCode.delete({ where: { id: otpCode.id } });
      throw genericError();
    }

    const codeMatches = await bcrypt.compare(dto.code, otpCode.codeHash);
    if (!codeMatches) {
      const attemptCount = otpCode.attemptCount + 1;
      if (attemptCount >= OTP_MAX_ATTEMPTS) {
        await this.prisma.otpCode.delete({ where: { id: otpCode.id } });
        throw new UnauthorizedException(
          'Too many incorrect attempts. Please request a new code.',
        );
      }
      await this.prisma.otpCode.update({
        where: { id: otpCode.id },
        data: { attemptCount },
      });
      throw new UnauthorizedException('Incorrect code. Please try again.');
    }

    await this.prisma.otpCode.delete({ where: { id: otpCode.id } });
    const verifiedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true },
    });

    const { accessToken, refreshToken } =
      await this.issueTokenPair(verifiedUser);

    // Best-effort — MailService already swallows its own failures so this
    // never affects the response already earned by the correct code (FR-013).
    void this.mailService.sendWelcomeEmail(verifiedUser.email);

    return {
      accessToken,
      refreshToken,
      userId: verifiedUser.id,
      emailVerified: true,
    };
  }

  // Issues a fresh code for a still-pending signup (FR-010). Responds with
  // the same generic shape whether or not the email has a pending account,
  // so this endpoint can't be used to probe which emails are registered.
  async resendOtp(dto: ResendOtpDto) {
    const genericResponse = { otpRequested: true };

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user || user.emailVerified) {
      return genericResponse;
    }

    const existing = await this.prisma.otpCode.findUnique({
      where: {
        userId_purpose: {
          userId: user.id,
          purpose: OtpPurpose.SIGNUP_VERIFICATION,
        },
      },
    });
    if (existing) {
      const elapsedMs = Date.now() - existing.lastSentAt.getTime();
      if (elapsedMs < OTP_RESEND_COOLDOWN_MS) {
        throw new HttpException(
          'Please wait before requesting another code.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    await this.issueAndSendOtp(user.id, user.email);
    return genericResponse;
  }

  // Belt-and-suspenders deletion of any OtpCode past its 5-minute TTL
  // (FR-016) — independent of whether its owner ever comes back to trigger
  // the opportunistic delete in verifyOtp()'s expiry check.
  @Cron(CronExpression.EVERY_MINUTE)
  async cleanupExpiredOtpCodes() {
    await this.prisma.otpCode.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  }

  // Shared by googleLogin() and UsersService's link/unlink flow
  // (specs/008-sidebar-profile-account/research.md §5) — a single verified
  // path for turning a Google ID token into a trustworthy email + subject id.
  async verifyGoogleIdToken(
    idToken: string,
  ): Promise<{ email: string; subjectId: string }> {
    const ticket = await this.googleClient.verifyIdToken({
      idToken,
      audience: this.configService.get<string>('GOOGLE_CLIENT_ID'),
    });
    const payload = ticket.getPayload();
    if (!payload?.email || !payload.sub) {
      throw new UnauthorizedException('Invalid Google token.');
    }
    return { email: payload.email, subjectId: payload.sub };
  }

  async googleLogin(dto: GoogleLoginDto) {
    const { email: googleEmail, subjectId: googleSubjectId } =
      await this.verifyGoogleIdToken(dto.idToken);

    const existingByGoogleId = await this.prisma.user.findUnique({
      where: { googleSubjectId },
    });
    if (existingByGoogleId) {
      const { accessToken, refreshToken } =
        await this.issueTokenPair(existingByGoogleId);
      const hasBaseline = await this.userHasBaseline(existingByGoogleId.id);
      return {
        accessToken,
        refreshToken,
        userId: existingByGoogleId.id,
        hasBaseline,
      };
    }

    const existingByEmail = await this.prisma.user.findUnique({
      where: { email: googleEmail },
    });

    // Merge into an existing system account only if its email is already
    // verified — merging into an unverified email would let someone who
    // squatted on that email with a system signup inherit the real owner's
    // Google-linked account (docs/architecture.md §3).
    if (existingByEmail && !existingByEmail.emailVerified) {
      throw new ConflictException(
        'An unverified account already exists for this email. Verify it before linking Google sign-in.',
      );
    }

    const user = existingByEmail
      ? await this.prisma.user.update({
          where: { id: existingByEmail.id },
          data: { googleSubjectId, emailVerified: true },
        })
      : await this.prisma.user.create({
          data: {
            email: googleEmail,
            googleSubjectId,
            emailVerified: true,
            timezone: dto.timezone,
          },
        });

    const { accessToken, refreshToken } = await this.issueTokenPair(user);
    const hasBaseline = await this.userHasBaseline(user.id);
    return { accessToken, refreshToken, userId: user.id, hasBaseline };
  }

  // Exchanges a still-valid refresh token for a new access/refresh pair,
  // revoking the presented one in the same operation (single-use rotation —
  // FR-003, FR-005, data-model.md Validation rules).
  async refreshTokens(dto: RefreshTokenDto) {
    let payload: { sub: string; email: string; jti: string };
    try {
      payload = this.refreshJwtService.verify(dto.refreshToken);
    } catch {
      throw new UnauthorizedException('Refresh token is invalid or expired.');
    }

    const stored = await this.prisma.refreshToken.findUnique({
      where: { id: payload.jti },
    });
    const isValid =
      stored &&
      stored.revokedAt === null &&
      stored.expiresAt > new Date() &&
      stored.tokenHash === hashToken(dto.refreshToken);
    if (!isValid) {
      throw new UnauthorizedException('Refresh token is invalid or expired.');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokenPair({ id: payload.sub, email: payload.email });
  }

  // Ends the user's session by revoking every refresh token they still hold
  // (FR-006). A user may have accumulated more than one active refresh
  // token (e.g. multiple devices); logout ends the caller's authenticated
  // session state entirely rather than leaving other rows silently valid.
  async logout(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { loggedOut: true };
  }
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
