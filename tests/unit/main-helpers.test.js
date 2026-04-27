import { describe, expect, it, vi } from 'vitest';

import { loadBrowserScriptExports } from '../helpers/load-browser-script.js';

function loadMainHelpers() {
  return loadBrowserScriptExports(
    'js/main.js',
    ['getInitials', 'formatCurrency', 'generateId'],
    { fetch: vi.fn() }
  );
}

describe('main.js shared helpers', () => {
  it('builds initials from first and last name', () => {
    const { getInitials } = loadMainHelpers();

    expect(getInitials('Abbas Musa')).toBe('AM');
    expect(getInitials('GearShift')).toBe('G');
  });

  it('returns a placeholder when no name is available', () => {
    const { getInitials } = loadMainHelpers();

    expect(getInitials('')).toBe('?');
    expect(getInitials(null)).toBe('?');
  });

  it('formats naira values consistently for dashboards and invoices', () => {
    const { formatCurrency } = loadMainHelpers();

    expect(formatCurrency(10500)).toBe('₦10,500.00');
    expect(formatCurrency(1234.5)).toBe('₦1,234.50');
    expect(formatCurrency(undefined)).toBe('₦0.00');
  });

  it('increments generated ids from the highest existing record', () => {
    const { generateId } = loadMainHelpers();

    const nextId = generateId('INV', [
      { id: 'INV-1001' },
      { id: 'INV-1008' },
      { id: 'INV-1003' },
    ]);

    expect(nextId).toBe('INV-1009');
  });
});
