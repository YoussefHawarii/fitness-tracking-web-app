import { ServiceUnavailableException } from '@nestjs/common';
import { ProductSource } from '@prisma/client';
import {
  classifyProviderCheck,
  PROVIDER_RECHECK_INTERVAL_MS,
  TRANSIENT_PROVIDER_BACKOFF_MS,
  TransientProviderBackoff,
  isProviderRecheckDue,
} from '../../src/modules/food/provider-retry-policy';
import type { ProductLookupResult } from '../../src/modules/food/providers/product-provider.interface';

describe('provider retry policy', () => {
  const answeredOutcomes: ProductLookupResult[] = [
    {
      outcome: 'FOUND_WITH_NUTRITION',
      product: { name: 'Complete', caloriesPer100g: 100 },
    },
    {
      outcome: 'FOUND_WITHOUT_NUTRITION',
      identification: {
        name: 'Identified',
        brand: null,
        imageUrl: null,
      },
    },
    { outcome: 'NOT_FOUND' },
  ];

  it.each(answeredOutcomes)(
    'classifies $outcome as a completed check',
    (result) => {
      expect(classifyProviderCheck({ result })).toEqual({
        kind: 'COMPLETED_CHECK',
        result,
      });
    },
  );

  it('classifies the client service-unavailable boundary as transient', () => {
    const error = new ServiceUnavailableException('OFF unavailable');
    expect(classifyProviderCheck({ error })).toEqual({
      kind: 'TRANSIENT_FAILURE',
      error,
    });
  });

  it('classifies an unexpected provider exception as non-transient', () => {
    const error = new TypeError('mapping bug');
    expect(classifyProviderCheck({ error })).toEqual({
      kind: 'NON_TRANSIENT_FAILURE',
      error,
    });
  });

  it('uses one 30-day boundary for completed-check freshness', () => {
    const checkedAt = new Date('2026-01-01T00:00:00.000Z');
    expect(
      isProviderRecheckDue(
        checkedAt,
        new Date(checkedAt.getTime() + PROVIDER_RECHECK_INTERVAL_MS - 1),
      ),
    ).toBe(false);
    expect(
      isProviderRecheckDue(
        checkedAt,
        new Date(checkedAt.getTime() + PROVIDER_RECHECK_INTERVAL_MS),
      ),
    ).toBe(true);
  });

  it('backs off transient failures independently of the 30-day timestamp', () => {
    const backoff = new TransientProviderBackoff();
    const source = ProductSource.OPEN_FOOD_FACTS;
    const barcode = '3017620422003';
    const failedAt = Date.parse('2026-01-01T00:00:00.000Z');

    backoff.recordFailure(source, barcode, failedAt);

    expect(
      backoff.isBlocked(
        source,
        barcode,
        failedAt + TRANSIENT_PROVIDER_BACKOFF_MS - 1,
      ),
    ).toBe(true);
    expect(
      backoff.isBlocked(
        source,
        barcode,
        failedAt + TRANSIENT_PROVIDER_BACKOFF_MS,
      ),
    ).toBe(false);
  });
});
