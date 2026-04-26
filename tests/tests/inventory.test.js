import { describe, it, expect } from 'vitest';

function isLowStock(qty, threshold) {
  return qty <= threshold;
}

function classifyTurnover(usageCount) {
  if (usageCount === 0)   return 'Dead Stock';
  if (usageCount <= 2)    return 'Slow Mover';
  if (usageCount <= 5)    return 'Medium Mover';
  return 'Fast Mover';
}

function calcStockDeficit(qty, threshold) {
  return Math.max(0, threshold - qty);
}

describe('isLowStock', () => {
  it('flags part at exactly threshold as low stock', () => {
    expect(isLowStock(5, 5)).toBe(true);
  });

  it('flags part below threshold', () => {
    expect(isLowStock(2, 5)).toBe(true);
  });

  it('does not flag part above threshold', () => {
    expect(isLowStock(10, 5)).toBe(false);
  });

  it('flags zero stock', () => {
    expect(isLowStock(0, 5)).toBe(true);
  });
});

describe('classifyTurnover — inventory reports', () => {
  it('0 uses = Dead Stock', () => {
    expect(classifyTurnover(0)).toBe('Dead Stock');
  });

  it('1–2 uses = Slow Mover', () => {
    expect(classifyTurnover(1)).toBe('Slow Mover');
    expect(classifyTurnover(2)).toBe('Slow Mover');
  });

  it('3–5 uses = Medium Mover', () => {
    expect(classifyTurnover(4)).toBe('Medium Mover');
  });

  it('6+ uses = Fast Mover', () => {
    expect(classifyTurnover(10)).toBe('Fast Mover');
  });
});

describe('calcStockDeficit', () => {
  it('returns shortfall when below threshold', () => {
    expect(calcStockDeficit(2, 10)).toBe(8);
  });

  it('returns 0 when stock is sufficient', () => {
    expect(calcStockDeficit(15, 10)).toBe(0);
  });
});