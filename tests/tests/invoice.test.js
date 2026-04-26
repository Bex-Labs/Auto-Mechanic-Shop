import { describe, it, expect } from 'vitest';

function calculateInvoice(laborHours, laborRate, parts, taxRatePct) {
  const labor    = Math.round(laborHours * laborRate * 100) / 100;
  const partsAmt = Math.round(
    parts.reduce((sum, p) => sum + p.qty * p.unit_cost, 0) * 100
  ) / 100;
  const tax   = Math.round((labor + partsAmt) * (taxRatePct / 100) * 100) / 100;
  const total = labor + partsAmt + tax;
  return { labor, parts: partsAmt, tax, total };
}

describe('calculateInvoice', () => {
  it('calculates labour + parts + tax correctly', () => {
    const result = calculateInvoice(
      3, 5000,
      [{ qty: 2, unit_cost: 3000 }],
      7.5
    );
    expect(result.labor).toBe(15000);
    expect(result.parts).toBe(6000);
    expect(result.tax).toBe(1575);
    expect(result.total).toBe(22575);
  });

  it('handles zero labour hours', () => {
    const result = calculateInvoice(0, 5000, [{ qty: 1, unit_cost: 2000 }], 0);
    expect(result.labor).toBe(0);
    expect(result.total).toBe(2000);
  });

  it('handles zero tax rate', () => {
    const result = calculateInvoice(2, 5000, [], 0);
    expect(result.tax).toBe(0);
    expect(result.total).toBe(10000);
  });

  it('handles no parts attached', () => {
    const result = calculateInvoice(1, 5000, [], 10);
    expect(result.parts).toBe(0);
    expect(result.tax).toBe(500);
    expect(result.total).toBe(5500);
  });

  it('rounds to 2 decimal places', () => {
    const result = calculateInvoice(1, 3333.33, [], 0);
    expect(result.labor).toBe(3333.33);
  });
});