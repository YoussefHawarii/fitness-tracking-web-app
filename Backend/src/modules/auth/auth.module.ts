import { Module } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuthKeys, REFRESH_JWT_SERVICE } from './keys';
import { KeysModule } from './keys.module';
import { MailModule } from '../mail/mail.module';

// Access tokens default to a flat 30-minute expiry here (FR-001/FR-012 — no
// sliding renewal; see specs/002-jwt-auth-rate-limit/research.md Decision 5).
// The default JwtService (from JwtModule below) is configured with the
// access-token secret and used for access tokens (and the purpose-scoped
// email-verification token). Refresh tokens (7-day expiry) are signed with
// a *separate* secret via the REFRESH_JWT_SERVICE provider below, so the
// two token types can have their signing secrets rotated independently.
@Module({
  imports: [
    PassportModule,
    ConfigModule,
    KeysModule,
    MailModule,
    JwtModule.registerAsync({
      imports: [KeysModule],
      inject: [AuthKeys],
      useFactory: (authKeys: AuthKeys) => ({
        secret: authKeys.accessSecret,
        signOptions: { algorithm: 'HS256', expiresIn: '30m' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    {
      provide: REFRESH_JWT_SERVICE,
      inject: [AuthKeys],
      useFactory: (authKeys: AuthKeys) =>
        new JwtService({
          secret: authKeys.refreshSecret,
          signOptions: { algorithm: 'HS256' },
          verifyOptions: { algorithms: ['HS256'] },
        }),
    },
  ],
  exports: [JwtModule, KeysModule, AuthService],
})
export class AuthModule {}
