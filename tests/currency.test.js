import { describe, it, expect } from 'vitest';

// Copy of formatCurrency from main.js
function formatCurrency(amount) {
  return '₦' + Number(amount || 0).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

describe('formatCurrency', () => {
  it('formats whole numbers correctly', () => {
    expect(formatCurrency(10500)).toBe('₦10,500.00');
  });

  it('formats decimal amounts', () => {
    expect(formatCurrency(1234.5)).toBe('₦1,234.50');
  });

  it('handles zero', () => {
    expect(formatCurrency(0)).toBe('₦0.00');
  });

  it('handles null', () => {
    expect(formatCurrency(null)).toBe('₦0.00');
  });

  it('handles undefined', () => {
    expect(formatCurrency(undefined)).toBe('₦0.00');
  });
});