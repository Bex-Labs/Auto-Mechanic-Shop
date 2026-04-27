import { describe, expect, it, vi } from 'vitest';

import { loadBrowserScriptExports } from '../helpers/load-browser-script.js';

function loadBilling(shop = { plan: 'free', plan_expires_at: null }) {
  const RBAC = {
    getShop: vi.fn().mockResolvedValue(shop),
    clearCache: vi.fn(),
  };

  const Auth = {
    getUser: vi.fn(),
  };

  const sb = {
    from: vi.fn(),
    functions: { invoke: vi.fn() },
  };

  const GS = {
    getSettings: vi.fn(),
  };

  const PaystackPop = {
    setup: vi.fn(),
  };

  const exports = loadBrowserScriptExports(
    'js/billing.js',
    ['BILLING', 'BillingStatus'],
    { RBAC, Auth, sb, GS, PaystackPop }
  );

  return { ...exports, RBAC };
}

describe('billing plan rules', () => {
  it('keeps Starter plan at 5 users with core features only', () => {
    const { BILLING } = loadBilling();

    expect(BILLING.PLAN_TIERS.free.label).toBe('Starter');
    expect(BILLING.PLAN_TIERS.free.limits.staff).toBe(5);
    expect(BILLING.PLAN_TIERS.free.featureAccess.reports).toBe(false);
    expect(BILLING.PLAN_TIERS.free.featureAccess.onlinePayments).toBe(false);
  });

  it('keeps Pro plan at 25 users with reports and online payments', () => {
    const { BILLING } = loadBilling({ plan: 'pro', plan_expires_at: '2099-12-31T00:00:00.000Z' });

    expect(BILLING.PLAN_TIERS.pro.label).toBe('Pro');
    expect(BILLING.PLAN_TIERS.pro.limits.staff).toBe(25);
    expect(BILLING.PLAN_TIERS.pro.featureAccess.reports).toBe(true);
    expect(BILLING.PLAN_TIERS.pro.featureAccess.onlinePayments).toBe(true);
  });

  it('formats resource limits using user-friendly labels', () => {
    const { BillingStatus } = loadBilling();

    expect(BillingStatus.formatLimit('staff', 5)).toBe('Up to 5 users');
    expect(BillingStatus.formatLimit('customers', null)).toBe('Unlimited customers');
  });

  it('blocks new staff creation once Starter has reached 5 active users', async () => {
    const { BillingStatus } = loadBilling({ plan: 'free', plan_expires_at: null });

    const result = await BillingStatus.checkLimit('staff', 5);

    expect(result.allowed).toBe(false);
    expect(result.limit).toBe(5);
    expect(result.message).toContain('Upgrade to Pro');
  });

  it('allows more staff when the shop is on an active Pro plan', async () => {
    const { BillingStatus } = loadBilling({ plan: 'pro', plan_expires_at: '2099-12-31T00:00:00.000Z' });

    const result = await BillingStatus.checkLimit('staff', 6);

    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(25);
    expect(result.remaining).toBe(19);
  });
});
