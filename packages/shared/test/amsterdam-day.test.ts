import { describe, expect, it } from 'vitest';
import { amsterdamDay, amsterdamDayBounds, isDay, shiftDay } from '../src/amsterdam-day.ts';

describe('Amsterdam calendar days', () => {
  it('gives the Amsterdam date of an instant', () => {
    expect(amsterdamDay(new Date('2026-11-12T22:59:59Z'))).toBe('2026-11-12');
    expect(amsterdamDay(new Date('2026-11-12T23:00:00Z'))).toBe('2026-11-13');
    expect(amsterdamDay(new Date('2026-07-01T21:59:59Z'))).toBe('2026-07-01');
    expect(amsterdamDay(new Date('2026-07-01T22:00:00Z'))).toBe('2026-07-02');
  });

  it('bounds a normal, a 25-hour and a 23-hour day', () => {
    expect(amsterdamDayBounds('2026-11-12')).toEqual({
      start: new Date('2026-11-11T23:00:00Z'),
      end: new Date('2026-11-12T23:00:00Z'),
    });
    expect(amsterdamDayBounds('2026-10-25')).toEqual({
      start: new Date('2026-10-24T22:00:00Z'),
      end: new Date('2026-10-25T23:00:00Z'),
    });
    expect(amsterdamDayBounds('2026-03-29')).toEqual({
      start: new Date('2026-03-28T23:00:00Z'),
      end: new Date('2026-03-29T22:00:00Z'),
    });
  });

  it('shifts and validates days', () => {
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(isDay('2026-11-12')).toBe(true);
    expect(isDay('2026-02-30')).toBe(false);
    expect(isDay('12-11-2026')).toBe(false);
    expect(isDay('2026-11-12T00:00')).toBe(false);
  });
});
