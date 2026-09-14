import { Injectable } from '@nestjs/common';
import type { OpenFoodFactsProduct } from './clients/open-food-facts.client';

const TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  product: OpenFoodFactsProduct;
  expiresAt: number;
}

// Short-lived, per-instance, in-memory cache keyed by barcode — see
// docs/food-log-input-modes-diagnosis.md §1.6 item 4. Avoids a redundant
// Open Food Facts call for createFoodLog/updateFoodLog immediately after a
// scan already resolved the same barcode via GET /food/barcode/:code, which
// is what let a scan's own request-storm (§1.2) make Save fail from the same
// rate limit. Deliberately not a persistent/shared cache — no Redis, no
// cross-instance concerns, matches this project's $0-hosting constraint.
@Injectable()
export class BarcodeLookupCacheService {
  private readonly entries = new Map<string, CacheEntry>();

  get size(): number {
    return this.entries.size;
  }

  get(barcode: string): OpenFoodFactsProduct | null {
    const entry = this.entries.get(barcode);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(barcode);
      return null;
    }
    return entry.product;
  }

  set(barcode: string, product: OpenFoodFactsProduct): void {
    this.entries.set(barcode, { product, expiresAt: Date.now() + TTL_MS });
    this.evictExpired();
  }

  // Expired entries otherwise only get removed when that exact barcode is
  // looked up again — a distinct barcode scanned once would sit in memory
  // forever. Sweeping on every write bounds the map to roughly "distinct
  // barcodes scanned in the last TTL_MS", not "ever scanned".
  private evictExpired(): void {
    const now = Date.now();
    for (const [barcode, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(barcode);
      }
    }
  }
}
