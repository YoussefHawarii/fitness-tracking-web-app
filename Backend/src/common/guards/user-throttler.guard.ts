import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

// Keys the rolling rate-limit window by authenticated user id when the
// request carries a valid access token, falling back to the connection's IP
// otherwise (FR-010, FR-011). Registered globally in app.module.ts.
//
// This guard runs before any route-level JwtAuthGuard (global guards run
// first in Nest's execution order), so req.user isn't populated yet here —
// the token has to be verified independently. An *unverified* token's `sub`
// claim can't be trusted either: a caller could mint a fresh forged `sub` on
// every request to dodge the limit entirely, so a signature-invalid token
// falls back to IP-based tracking, same as no token at all.
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwtService: JwtService,
  ) {
    super(options, storageService, reflector);
  }

  protected getTracker(req: Request): Promise<string> {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : undefined;

    if (token) {
      try {
        const payload = this.jwtService.verify<{ sub: string }>(token);
        return Promise.resolve(payload.sub);
      } catch {
        // Falls through to IP-based tracking below.
      }
    }

    return Promise.resolve(req.ip ?? 'unknown');
  }
}
