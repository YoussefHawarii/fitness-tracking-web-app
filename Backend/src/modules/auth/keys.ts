import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Injection token for the refresh-token-specific JwtService instance
// (registered as a factory provider in AuthModule). Kept separate from the
// default JwtService, which is configured for access tokens only.
export const REFRESH_JWT_SERVICE = Symbol('REFRESH_JWT_SERVICE');

// Two separate HS256 secrets — one for access tokens, one for refresh
// tokens — so either can be rotated independently of the other (e.g. a
// compromised refresh secret can be rotated without invalidating every
// currently-live access token, and vice versa).
@Injectable()
export class AuthKeys {
  readonly accessSecret: string;
  readonly refreshSecret: string;

  constructor(private readonly configService: ConfigService) {
    this.accessSecret = requireEnv(this.configService, 'ACCESS_TOKEN');
    this.refreshSecret = requireEnv(this.configService, 'REFRESH_TOKEN');
  }
}

function requireEnv(configService: ConfigService, key: string): string {
  const value = configService.get<string>(key);
  if (!value) {
    throw new Error(`Missing required env var ${key}`);
  }
  return value;
}
