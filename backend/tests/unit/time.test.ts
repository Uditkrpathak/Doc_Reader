import { describe, it, expect } from 'vitest';
import { getIndiaDayBucket, getNextIndiaMidnight, getServerTime } from '../../src/shared/time';

describe('Server Time & India Midnight Boundary (UTC+5:30)', () => {
  it('returns valid ISO serverTime', () => {
    const now = new Date();
    const iso = getServerTime(now);
    expect(new Date(iso).getTime()).toBe(now.getTime());
  });

  it('correctly categorizes boundary at 23:59:59 IST vs 00:00:00 IST', () => {
    // 2026-11-05 23:59:59 IST = 2026-11-05 18:29:59 UTC
    const beforeMidnightUTC = new Date('2026-11-05T18:29:59.000Z');
    expect(getIndiaDayBucket(beforeMidnightUTC)).toBe('2026-11-05');

    // 2026-11-06 00:00:00 IST = 2026-11-05 18:30:00 UTC
    const atMidnightUTC = new Date('2026-11-05T18:30:00.000Z');
    expect(getIndiaDayBucket(atMidnightUTC)).toBe('2026-11-06');

    // 2026-11-06 00:00:01 IST = 2026-11-05 18:30:01 UTC
    const afterMidnightUTC = new Date('2026-11-05T18:30:01.000Z');
    expect(getIndiaDayBucket(afterMidnightUTC)).toBe('2026-11-06');
  });

  it('computes exact next midnight IST', () => {
    // If it is 2026-11-05 10:00:00 UTC (which is 15:30:00 IST)
    const midDayUTC = new Date('2026-11-05T10:00:00.000Z');
    const nextMidnight = getNextIndiaMidnight(midDayUTC);

    // Next midnight IST will be 2026-11-06 00:00:00 IST = 2026-11-05 18:30:00 UTC
    expect(nextMidnight.toISOString()).toBe('2026-11-05T18:30:00.000Z');
    expect(getIndiaDayBucket(nextMidnight)).toBe('2026-11-06');
  });
});

