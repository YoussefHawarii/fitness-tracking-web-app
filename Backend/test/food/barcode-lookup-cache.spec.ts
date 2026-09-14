import { BarcodeLookupCacheService } from '../../src/modules/food/barcode-lookup-cache.service';
import type { OpenFoodFactsProduct } from '../../src/modules/food/clients/open-food-facts.client';

const product: OpenFoodFactsProduct = {
  barcode: '3017620422003',
  name: 'Nutella',
  caloriesPer100g: 539,
  proteinPer100g: 6.3,
  carbsPer100g: 57.5,
  fatPer100g: 30.9,
};

describe('BarcodeLookupCacheService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns null for a barcode that was never cached', () => {
    const cache = new BarcodeLookupCacheService();
    expect(cache.get('unknown')).toBeNull();
  });

  it('returns the cached product for a barcode that was set', () => {
    const cache = new BarcodeLookupCacheService();
    cache.set(product.barcode, product);
    expect(cache.get(product.barcode)).toEqual(product);
  });

  it('stops returning the product once its TTL has elapsed', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const cache = new BarcodeLookupCacheService();
    cache.set(product.barcode, product);
    expect(cache.get(product.barcode)).toEqual(product);

    // TTL is 5 minutes — advance 6 to cross it.
    jest.setSystemTime(new Date('2026-01-01T00:06:00.000Z'));
    expect(cache.get(product.barcode)).toBeNull();
  });

  it('still returns the product just under the TTL boundary', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const cache = new BarcodeLookupCacheService();
    cache.set(product.barcode, product);

    jest.setSystemTime(new Date('2026-01-01T00:04:59.000Z'));
    expect(cache.get(product.barcode)).toEqual(product);
  });

  it('keeps entries for different barcodes independent', () => {
    const cache = new BarcodeLookupCacheService();
    cache.set('111', product);
    expect(cache.get('222')).toBeNull();
    expect(cache.get('111')).toEqual(product);
  });

  it('evicts an already-expired entry when a different barcode is set, without waiting for it to be read again', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const cache = new BarcodeLookupCacheService();
    cache.set('111', product);

    jest.setSystemTime(new Date('2026-01-01T00:06:00.000Z'));
    cache.set('222', product); // triggers the opportunistic sweep

    expect(cache.size).toBe(1); // only '222' should remain
  });
});
