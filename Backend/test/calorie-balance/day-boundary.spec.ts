import { getDayBoundaryUtc } from '../../src/modules/calorie-balance/day-boundary.util';

describe('day-boundary.util', () => {
  it('computes UTC midnight-to-midnight for a UTC user', () => {
    const { startUtc, endUtc } = getDayBoundaryUtc('2026-03-05', 'UTC');
    expect(startUtc.toISOString()).toBe('2026-03-05T00:00:00.000Z');
    expect(endUtc.toISOString()).toBe('2026-03-06T00:00:00.000Z');
  });

  it('shifts the boundary earlier in UTC for a timezone ahead of UTC (Africa/Cairo, UTC+2)', () => {
    const { startUtc, endUtc } = getDayBoundaryUtc(
      '2026-03-05',
      'Africa/Cairo',
    );
    expect(startUtc.toISOString()).toBe('2026-03-04T22:00:00.000Z');
    expect(endUtc.toISOString()).toBe('2026-03-05T22:00:00.000Z');
  });

  it('shifts the boundary later in UTC for a timezone behind UTC (America/New_York)', () => {
    const { startUtc } = getDayBoundaryUtc('2026-03-05', 'America/New_York');
    // EST is UTC-5 in March (before DST starts)
    expect(startUtc.toISOString()).toBe('2026-03-05T05:00:00.000Z');
  });

  it('always spans exactly 24 hours regardless of timezone', () => {
    const { startUtc, endUtc } = getDayBoundaryUtc(
      '2026-03-05',
      'Africa/Cairo',
    );
    expect(endUtc.getTime() - startUtc.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});
