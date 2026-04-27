import { describe, it, expect } from 'vitest';

const COMMISSION_RATE = 0.05;

function calcCommission(grossNaira) {
  const commission = Math.round(grossNaira * COMMISSION_RATE * 100) / 100;
  const shopAmount = Math.round((grossNaira - commission) * 100) / 100;
  return { commission, shopAmount };
}

function calcKobo(naira) {
  return Math.round(naira * 100);
}

describe('calcCommission — Paystack 5% split', () => {
  it('5% of ₦50,000 = ₦2,500 commission', () => {
    const r = calcCommission(50000);
    expect(r.commission).toBe(2500);
    expect(r.shopAmount).toBe(47500);
  });

  it('shop always gets 95%', () => {
    const r = calcCommission(100000);
    expect(r.shopAmount).toBe(95000);
  });

  it('zero invoice amount', () => {
    const r = calcCommission(0);
    expect(r.commission).toBe(0);
    expect(r.shopAmount).toBe(0);
  });
});

describe('calcKobo — Naira to kobo conversion', () => {
  it('₦10,500 = 1,050,000 kobo (monthly plan)', () => {
    expect(calcKobo(10500)).toBe(1050000);
  });

  it('₦90,000 = 9,000,000 kobo (annual plan)', () => {
    expect(calcKobo(90000)).toBe(9000000);
  });
});