import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { ProductSource } from '@prisma/client';
import type { ProductLookupResult } from './providers/product-provider.interface';

export const PROVIDER_RECHECK_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
export const TRANSIENT_PROVIDER_BACKOFF_MS = 60 * 1000;

export type ProviderCheckClassification =
  | { kind: 'COMPLETED_CHECK'; result: ProductLookupResult }
  | { kind: 'TRANSIENT_FAILURE'; error: ServiceUnavailableException }
  | { kind: 'NON_TRANSIENT_FAILURE'; error: unknown };

export function classifyProviderCheck(
  outcome:
    | { result: ProductLookupResult; error?: never }
    | { result?: never; error: unknown },
): ProviderCheckClassification {
  if ('result' in outcome && outcome.result) {
    return { kind: 'COMPLETED_CHECK', result: outcome.result };
  }
  return outcome.error instanceof ServiceUnavailableException
    ? { kind: 'TRANSIENT_FAILURE', error: outcome.error }
    : { kind: 'NON_TRANSIENT_FAILURE', error: outcome.error };
}

export function isProviderRecheckDue(
  lastProviderCheckAt: Date,
  now: Date,
): boolean {
  return (
    now.getTime() - lastProviderCheckAt.getTime() >=
    PROVIDER_RECHECK_INTERVAL_MS
  );
}

@Injectable()
export class TransientProviderBackoff {
  private readonly blockedUntil = new Map<string, number>();

  isBlocked(source: ProductSource, barcode: string, now = Date.now()): boolean {
    const key = this.key(source, barcode);
    const until = this.blockedUntil.get(key);
    if (until === undefined) return false;
    if (until <= now) {
      this.blockedUntil.delete(key);
      return false;
    }
    return true;
  }

  recordFailure(
    source: ProductSource,
    barcode: string,
    now = Date.now(),
  ): void {
    this.blockedUntil.set(
      this.key(source, barcode),
      now + TRANSIENT_PROVIDER_BACKOFF_MS,
    );
    this.evictExpired(now);
  }

  clear(source: ProductSource, barcode: string): void {
    this.blockedUntil.delete(this.key(source, barcode));
  }

  private key(source: ProductSource, barcode: string): string {
    return `${source}:${barcode}`;
  }

  private evictExpired(now: number): void {
    for (const [key, until] of this.blockedUntil) {
      if (until <= now) this.blockedUntil.delete(key);
    }
  }
}
