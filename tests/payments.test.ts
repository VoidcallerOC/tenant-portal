import { describe, expect, it } from 'vitest';
import { dueDateForPeriod } from '../src/payments/service.js';

describe('rent payment periods', () => {
  it('clamps a lease start day to the last day of the charge month', () => {
    expect(dueDateForPeriod('2026-01-31', '2026-02-01')).toBe('2026-02-28');
    expect(dueDateForPeriod('2024-01-31', '2024-02-01')).toBe('2024-02-29');
  });

  it('keeps the lease start day when the month contains it', () => {
    expect(dueDateForPeriod('2026-01-15', '2026-04-01')).toBe('2026-04-15');
  });
});
