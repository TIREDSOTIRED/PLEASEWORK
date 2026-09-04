import { describe, it, expect } from 'vitest';
import { localDateKey, isSameLocalDay, todayLocalKey } from '../dayKey';

/**
 * Regression suite for the ledger daily-boundary fix.
 *
 * Bug: ledger timestamps are UTC ISO strings, but daily filters compared the
 * UTC date SUBSTRING against the local date key — sales made between local
 * 00:00 and 02:59 (Damascus, UTC+3) were attributed to the previous day.
 */

const offsetMin = new Date('2026-09-04T21:30:00.000Z').getTimezoneOffset();

// Midnight-crossing assertions are meaningful only where local time is UTC+3
// (the pilot environment). They skip gracefully on other-offset machines.
const itUTCPlus3 = offsetMin === -180 ? it : it.skip;

describe('localDateKey — local calendar day, never UTC slicing', () => {
  itUTCPlus3('assigns a sale made at local 00:30 (21:30 UTC the previous day) to the correct local day', () => {
    // 2026-09-04T21:30:00Z == 2026-09-05 00:30 Damascus time.
    // The old UTC-substring logic returned '2026-09-04' here — the regression.
    expect(localDateKey('2026-09-04T21:30:00.000Z')).toBe('2026-09-05');
    expect(localDateKey('2026-09-04T21:30:00.000Z')).not.toBe('2026-09-04');
  });

  itUTCPlus3('assigns local 02:59:59 to the same local day as local 00:00', () => {
    // 2026-09-04T23:59:59Z == 2026-09-05 02:59:59 Damascus.
    expect(localDateKey('2026-09-04T23:59:59.999Z')).toBe('2026-09-05');
  });

  itUTCPlus3('keeps a 22:00 local evening sale on its own day', () => {
    // 2026-09-04T19:00:00Z == 2026-09-04 22:00 Damascus.
    expect(localDateKey('2026-09-04T19:00:00.000Z')).toBe('2026-09-04');
  });

  it('accepts locally-constructed Dates deterministically on any timezone', () => {
    const local = new Date(2026, 8, 5, 0, 30); // 2026-09-05 00:30 LOCAL
    expect(localDateKey(local)).toBe('2026-09-05');
    expect(localDateKey(local.toISOString())).toBe('2026-09-05');
    expect(localDateKey(local.getTime())).toBe('2026-09-05');
  });

  it('zero-pads month and day', () => {
    expect(localDateKey(new Date(2026, 0, 3, 12, 0))).toBe('2026-01-03');
  });

  it('fails safely on invalid or empty input', () => {
    expect(localDateKey('')).toBe('');
    expect(localDateKey(null)).toBe('');
    expect(localDateKey(undefined)).toBe('');
    expect(localDateKey('not-a-date')).toBe('');
    expect(localDateKey(new Date('garbage'))).toBe('');
  });
});

describe('isSameLocalDay', () => {
  itUTCPlus3('local-midnight-crossing timestamp matches its LOCAL day, not its UTC date', () => {
    expect(isSameLocalDay('2026-09-04T21:30:00.000Z', '2026-09-05')).toBe(true);
    expect(isSameLocalDay('2026-09-04T21:30:00.000Z', '2026-09-04')).toBe(false);
  });

  it('returns false for invalid timestamps or empty keys — never a false positive', () => {
    expect(isSameLocalDay('garbage', '2026-09-05')).toBe(false);
    expect(isSameLocalDay('2026-09-05T10:00:00Z', '')).toBe(false);
    expect(isSameLocalDay(null, '2026-09-05')).toBe(false);
  });

  it('matches ordinary same-day timestamps', () => {
    const noon = new Date(2026, 8, 5, 12, 0).toISOString();
    expect(isSameLocalDay(noon, '2026-09-05')).toBe(true);
    expect(isSameLocalDay(noon, '2026-09-06')).toBe(false);
  });
});

describe('todayLocalKey', () => {
  it('equals the local Y-M-D of right now', () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(todayLocalKey()).toBe(expected);
  });
});
