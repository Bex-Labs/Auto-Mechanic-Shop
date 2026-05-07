import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SESSION_TABLE = 'auth_sessions';
const PLATFORM_AUDIT_TABLE = 'platform_admin';
const ACTION_REVOKE = 'SESSION_REVOKE';
const ACTIVE_ACTIONS = new Set(['SESSION_START', 'SESSION_HEARTBEAT', 'SESSION_END']);
const ACTIVE_SESSION_WINDOW_MS = 35 * 60 * 1000;
const RECENT_GROWTH_WINDOW_DAYS = 30;
const RECENT_SIGNUP_WINDOW_DAYS = 7;
const PLAN_EXPIRY_WARNING_DAYS = 7;
const INACTIVE_PAID_SHOP_DAYS = 14;
const HIGH_SESSION_ALERT_THRESHOLD = 4;
const STARTER_STAFF_LIMIT = 5;
const PRO_STAFF_LIMIT = 25;
const PRO_MONTHLY_PRICE_NAIRA = 10500;
const PRO_ANNUAL_PRICE_NAIRA = 90000;
const SHOP_SUSPEND_ACTION = 'SHOP_SUSPEND';
const SHOP_UNSUSPEND_ACTION = 'SHOP_UNSUSPEND';
const PLATFORM_USER_DEACTIVATE_ACTION = 'PLATFORM_USER_DEACTIVATE';
const PLATFORM_USER_REACTIVATE_ACTION = 'PLATFORM_USER_REACTIVATE';
const PLATFORM_REVOKE_USER_SESSIONS_ACTION = 'PLATFORM_REVOKE_USER_SESSIONS';
const SHOP_PLAN_UPDATE_ACTION = 'SHOP_PLAN_UPDATE';
const SHOP_PLAN_EXTEND_ACTION = 'SHOP_PLAN_EXTEND';

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function parseChanges(raw: unknown) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); }
    catch { return {}; }
  }
  return typeof raw === 'object' ? raw : {};
}

function getOwnerEmailSet() {
  const raw = Deno.env.get('PLATFORM_OWNER_EMAILS') || 'abbassani94@gmail.com';
  return new Set(
    raw.split(',')
      .map(value => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function isPlatformOwner(authUser: { email?: string | null; user_metadata?: Record<string, unknown> } | null, profile: { email?: string | null; role?: string | null } | null = null) {
  const email = String(authUser?.email || profile?.email || '').trim().toLowerCase();
  const role = String(profile?.role || authUser?.user_metadata?.role || '').trim();
  return (email && getOwnerEmailSet().has(email)) || role === 'Owner';
}

async function getRequester(adminClient: ReturnType<typeof createClient>, req: Request) {
  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  if (!token) throw new Error('No token');

  const { data: { user }, error: userErr } = await adminClient.auth.getUser(token);
  if (userErr || !user) throw new Error('Invalid token');

  const { data: profile, error: profileErr } = await adminClient
    .from('profiles')
    .select('id, email, role, full_name, active, shop_id')
    .eq('id', user.id)
    .maybeSingle();

  if (profileErr) throw new Error(profileErr.message);
  if (!isPlatformOwner(user, profile)) throw new Error('Owner access required');

  return { user, profile };
}

async function listAllAuthUsers(adminClient: ReturnType<typeof createClient>) {
  const allUsers = [];
  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const users = data?.users || [];
    allUsers.push(...users);

    if (!data?.nextPage || users.length < perPage) break;
    page = data.nextPage;
  }

  return allUsers;
}

type SessionState = {
  sessionId: string;
  userId: string | null;
  latestAt: string | null;
  lastAction: string | null;
  revokedAt: string | null;
  deviceLabel: string | null;
  locationLabel: string | null;
};

type ActiveSessionSummary = {
  session_count: number;
  last_active_at: string | null;
  device_labels: string[];
  location_labels: string[];
};

type EnrichedSessionState = SessionState & {
  status: string;
  active: boolean;
};

function buildSessionStates(rows: Array<Record<string, unknown>>): EnrichedSessionState[] {
  const sessionMap = new Map<string, SessionState>();
  const now = Date.now();

  for (const row of rows || []) {
    const sessionId = String(row.record_id || '').trim();
    if (!sessionId) continue;

    const action = String(row.action || '');
    const createdAt = String(row.created_at || '');
    const changedBy = row.changed_by ? String(row.changed_by) : null;
    const changes = parseChanges(row.changes);

    const current = sessionMap.get(sessionId) || {
      sessionId,
      userId: null,
      latestAt: null,
      lastAction: null,
      revokedAt: null,
      deviceLabel: null,
      locationLabel: null,
    };

    if (ACTIVE_ACTIONS.has(action)) {
      if (!current.userId && changedBy) current.userId = changedBy;
      if (!current.latestAt || new Date(createdAt).getTime() > new Date(current.latestAt).getTime()) {
        current.latestAt = createdAt;
        current.lastAction = action;
        current.deviceLabel = String((changes as Record<string, unknown>).device_label || current.deviceLabel || '');
        current.locationLabel = String((changes as Record<string, unknown>).location_label || current.locationLabel || '');
      }
    }

    if (action === ACTION_REVOKE) {
      if (!current.revokedAt || new Date(createdAt).getTime() > new Date(current.revokedAt).getTime()) {
        current.revokedAt = createdAt;
      }
    }

    sessionMap.set(sessionId, current);
  }

  return [...sessionMap.values()].map(state => {
    const latestMs = state.latestAt ? new Date(state.latestAt).getTime() : 0;
    const active = !!state.userId
      && !state.revokedAt
      && state.lastAction !== 'SESSION_END'
      && latestMs > 0
      && now - latestMs <= ACTIVE_SESSION_WINDOW_MS;

    return {
      ...state,
      status: active ? 'active' : (state.revokedAt ? 'revoked' : (state.lastAction === 'SESSION_END' ? 'ended' : 'inactive')),
      active,
    };
  });
}

function buildActiveSessionSummaryByUser(sessionStates: EnrichedSessionState[]) {
  const summaryByUser = new Map<string, ActiveSessionSummary>();

  sessionStates.forEach(session => {
    if (!session.active || !session.userId) return;
    const current = summaryByUser.get(session.userId) || {
      session_count: 0,
      last_active_at: null,
      device_labels: [],
      location_labels: [],
    };

    current.session_count += 1;

    if (
      session.latestAt
      && (!current.last_active_at || new Date(session.latestAt).getTime() > new Date(current.last_active_at).getTime())
    ) {
      current.last_active_at = session.latestAt;
    }

    if (session.deviceLabel && !current.device_labels.includes(session.deviceLabel)) {
      current.device_labels.push(session.deviceLabel);
    }

    if (session.locationLabel && !current.location_labels.includes(session.locationLabel)) {
      current.location_labels.push(session.locationLabel);
    }

    summaryByUser.set(session.userId, current);
  });

  return summaryByUser;
}

function buildShopSuspensionMap(rows: Array<Record<string, unknown>>) {
  const latestByShop = new Map<string, {
    suspended: boolean;
    action: string | null;
    updated_at: string | null;
    changed_by: string | null;
    reason: string | null;
  }>();

  for (const row of rows || []) {
    const shopId = String(row.record_id || '').trim();
    if (!shopId || latestByShop.has(shopId)) continue;
    const changes = parseChanges(row.changes) as Record<string, unknown>;
    latestByShop.set(shopId, {
      suspended: String(row.action || '') === SHOP_SUSPEND_ACTION,
      action: row.action ? String(row.action) : null,
      updated_at: row.created_at ? String(row.created_at) : null,
      changed_by: row.changed_by ? String(row.changed_by) : null,
      reason: changes?.reason ? String(changes.reason) : null,
    });
  }

  return latestByShop;
}

async function insertAuditRows(adminClient: ReturnType<typeof createClient>, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return;
  const { error } = await adminClient.from('audit_logs').insert(rows);
  if (error) throw new Error(error.message);
}

function actionLabel(action: string) {
  switch (action) {
    case SHOP_SUSPEND_ACTION: return 'Suspended shop';
    case SHOP_UNSUSPEND_ACTION: return 'Unsuspended shop';
    case PLATFORM_USER_DEACTIVATE_ACTION: return 'Deactivated user';
    case PLATFORM_USER_REACTIVATE_ACTION: return 'Reactivated user';
    case PLATFORM_REVOKE_USER_SESSIONS_ACTION: return 'Forced sign-out';
    case SHOP_PLAN_UPDATE_ACTION: return 'Updated shop plan';
    case SHOP_PLAN_EXTEND_ACTION: return 'Extended plan expiry';
    default: return action.replace(/_/g, ' ').toLowerCase();
  }
}

function isActiveProShop(shop: Record<string, unknown> | null) {
  if (!shop || String(shop.plan || 'free') !== 'pro') return false;
  if (!shop.plan_expires_at) return true;
  return new Date(String(shop.plan_expires_at)).getTime() > Date.now();
}

function planStaffLimit(plan: string | null | undefined) {
  return String(plan || 'free').toLowerCase() === 'pro' ? PRO_STAFF_LIMIT : STARTER_STAFF_LIMIT;
}

function severityRank(value: string) {
  if (value === 'high') return 0;
  if (value === 'medium') return 1;
  return 2;
}

function normalizePlan(value: unknown) {
  return String(value || 'free').trim().toLowerCase() === 'pro' ? 'pro' : 'free';
}

function normalizeBillingCycle(value: unknown) {
  return String(value || 'monthly').trim().toLowerCase() === 'annual' ? 'annual' : 'monthly';
}

function addBillingCycle(baseDate: Date, cycle: string) {
  const next = new Date(baseDate);
  if (cycle === 'annual') {
    next.setFullYear(next.getFullYear() + 1);
  } else {
    next.setMonth(next.getMonth() + 1);
  }
  return next;
}

function addDays(baseDate: Date, days: number) {
  const next = new Date(baseDate);
  next.setDate(next.getDate() + days);
  return next;
}

function positiveWholeNumber(value: unknown) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

async function getOverview(adminClient: ReturnType<typeof createClient>) {
  const recentActivitySince = new Date(Date.now() - (90 * 24 * 60 * 60 * 1000)).toISOString();

  const [authUsers, profilesRes, shopsRes, sessionLogsRes, shopStatusLogsRes, ownerAuditLogsRes, billingTransactionsRes, recentActivityLogsRes] = await Promise.all([
    listAllAuthUsers(adminClient),
    adminClient.from('profiles').select('id, full_name, role, email, shop_id, active'),
    adminClient.from('shops').select('id, name, plan, plan_billing_cycle, created_at, plan_expires_at').order('created_at', { ascending: false }),
    adminClient.from('audit_logs').select('record_id, changed_by, action, created_at, changes').eq('table_name', SESSION_TABLE).order('created_at', { ascending: false }),
    adminClient.from('audit_logs')
      .select('record_id, changed_by, action, created_at, changes')
      .eq('table_name', 'shops')
      .in('action', [SHOP_SUSPEND_ACTION, SHOP_UNSUSPEND_ACTION])
      .order('created_at', { ascending: false }),
    adminClient.from('audit_logs')
      .select('id, record_id, changed_by, action, created_at, changes')
      .eq('table_name', PLATFORM_AUDIT_TABLE)
      .order('created_at', { ascending: false })
      .limit(12),
    adminClient.from('billing_transactions')
      .select('shop_id, type, status, plan_cycle, gross_amount, created_at')
      .eq('type', 'subscription')
      .eq('status', 'success')
      .order('created_at', { ascending: true }),
    adminClient.from('audit_logs')
      .select('changed_by, table_name, created_at')
      .neq('table_name', SESSION_TABLE)
      .gte('created_at', recentActivitySince)
      .order('created_at', { ascending: false }),
  ]);

  if (profilesRes.error) throw new Error(profilesRes.error.message);
  if (shopsRes.error) throw new Error(shopsRes.error.message);
  if (sessionLogsRes.error) throw new Error(sessionLogsRes.error.message);
  if (shopStatusLogsRes.error) throw new Error(shopStatusLogsRes.error.message);
  if (ownerAuditLogsRes.error) throw new Error(ownerAuditLogsRes.error.message);
  if (billingTransactionsRes.error) throw new Error(billingTransactionsRes.error.message);
  if (recentActivityLogsRes.error) throw new Error(recentActivityLogsRes.error.message);

  const profiles = profilesRes.data || [];
  const shops = shopsRes.data || [];
  const sessionStates = buildSessionStates(sessionLogsRes.data || []);
  const activeSessionSummaryByUser = buildActiveSessionSummaryByUser(sessionStates);
  const suspensionByShopId = buildShopSuspensionMap(shopStatusLogsRes.data || []);
  const billingTransactions = billingTransactionsRes.data || [];

  const profileById = new Map(profiles.map(profile => [profile.id, profile]));
  const shopById = new Map(shops.map(shop => [shop.id, shop]));
  const authUserIds = new Set(authUsers.map(user => user.id));
  const liveUserCountByShop = new Map<string, number>();
  const liveSessionCountByShop = new Map<string, number>();
  const lastActivityByShop = new Map<string, string>();

  (recentActivityLogsRes.data || []).forEach(row => {
    const actorId = row.changed_by ? String(row.changed_by) : '';
    if (!actorId) return;
    const profile = profileById.get(actorId);
    const shopId = profile?.shop_id ? String(profile.shop_id) : '';
    if (!shopId || lastActivityByShop.has(shopId)) return;
    if (row.created_at) lastActivityByShop.set(shopId, String(row.created_at));
  });

  const users = authUsers.map(user => {
    const profile = profileById.get(user.id) || null;
    const shop = profile?.shop_id ? shopById.get(profile.shop_id) : null;
    const owner = isPlatformOwner(user, profile);
    const sessionSummary = activeSessionSummaryByUser.get(user.id);
    return {
      id: user.id,
      full_name: profile?.full_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Unknown User',
      email: user.email || profile?.email || null,
      role: owner ? 'Owner' : (profile?.role || user.user_metadata?.role || 'User'),
      shop_id: profile?.shop_id || null,
      shop_name: shop?.name || null,
      plan: shop?.plan || 'free',
      active: owner ? true : profile?.active !== false,
      created_at: user.created_at || null,
      last_sign_in_at: user.last_sign_in_at || null,
      email_confirmed_at: user.email_confirmed_at || null,
      session_count: sessionSummary?.session_count || 0,
      last_active_at: sessionSummary?.last_active_at || null,
      device_labels: sessionSummary?.device_labels || [],
      location_labels: sessionSummary?.location_labels || [],
      is_owner: owner,
    };
  });

  for (const profile of profiles) {
    if (authUserIds.has(profile.id)) continue;
    const shop = profile?.shop_id ? shopById.get(profile.shop_id) : null;
    const owner = isPlatformOwner(null, profile);
    const sessionSummary = activeSessionSummaryByUser.get(profile.id);
    users.push({
      id: profile.id,
      full_name: profile.full_name || profile.email || 'Unknown User',
      email: profile.email || null,
      role: owner ? 'Owner' : (profile.role || 'User'),
      shop_id: profile.shop_id || null,
      shop_name: shop?.name || null,
      plan: shop?.plan || 'free',
      active: owner ? true : profile.active !== false,
      created_at: null,
      last_sign_in_at: null,
      email_confirmed_at: null,
      session_count: sessionSummary?.session_count || 0,
      last_active_at: sessionSummary?.last_active_at || null,
      device_labels: sessionSummary?.device_labels || [],
      location_labels: sessionSummary?.location_labels || [],
      is_owner: owner,
    });
  }

  users.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  const userNameById = new Map(users.map(user => [user.id, user.full_name || user.email || 'Unknown User']));

  const signedInUsers = users
    .filter(user => (user.session_count || 0) > 0)
    .sort((a, b) => {
      const timeDiff = new Date(b.last_active_at || 0).getTime() - new Date(a.last_active_at || 0).getTime();
      if (timeDiff !== 0) return timeDiff;
      return String(a.full_name || a.email || '').localeCompare(String(b.full_name || b.email || ''));
    });

  const shopUserStats = new Map<string, { total_users: number; active_users: number; inactive_users: number; admin_users: number }>();
  users.forEach(user => {
    if (!user.shop_id) return;
    const current = shopUserStats.get(user.shop_id) || { total_users: 0, active_users: 0, inactive_users: 0, admin_users: 0 };
    current.total_users += 1;
    if (user.active) current.active_users += 1;
    else current.inactive_users += 1;
    if (user.role === 'Admin') current.admin_users += 1;
    if ((user.session_count || 0) > 0) {
      liveUserCountByShop.set(user.shop_id, (liveUserCountByShop.get(user.shop_id) || 0) + 1);
      liveSessionCountByShop.set(user.shop_id, (liveSessionCountByShop.get(user.shop_id) || 0) + Number(user.session_count || 0));
    }
    shopUserStats.set(user.shop_id, current);
  });

  const shopRows = shops.map(shop => {
    const suspension = suspensionByShopId.get(shop.id);
    const paid = isActiveProShop(shop);
    return {
      id: shop.id,
      name: shop.name || 'Unnamed Shop',
      plan: shop.plan || 'free',
      plan_billing_cycle: shop.plan_billing_cycle || null,
      created_at: shop.created_at || null,
      plan_expires_at: shop.plan_expires_at || null,
      total_users: shopUserStats.get(shop.id)?.total_users || 0,
      active_users: shopUserStats.get(shop.id)?.active_users || 0,
      inactive_users: shopUserStats.get(shop.id)?.inactive_users || 0,
      admin_users: shopUserStats.get(shop.id)?.admin_users || 0,
      live_users: liveUserCountByShop.get(shop.id) || 0,
      live_sessions: liveSessionCountByShop.get(shop.id) || 0,
      last_activity_at: lastActivityByShop.get(shop.id) || null,
      paid,
      suspended: !!suspension?.suspended,
      suspended_at: suspension?.updated_at || null,
      suspension_reason: suspension?.reason || null,
      suspended_by: suspension?.changed_by || null,
      suspended_by_name: suspension?.changed_by ? (userNameById.get(suspension.changed_by) || null) : null,
    };
  });

  const nonOwnerUsers = users.filter(user => !user.is_owner);
  const shopAdminUsers = nonOwnerUsers.filter(user => user.role === 'Admin' && user.shop_id);
  const staffAccounts = nonOwnerUsers.filter(user => ['Mechanic', 'Service Advisor', 'Parts Manager'].includes(String(user.role || '')));
  const paidShops = shopRows.filter(shop => shop.paid);
  const suspendedShops = shopRows.filter(shop => shop.suspended);
  const activeShops = shopRows.filter(shop => shop.active_users > 0 && !shop.suspended);
  const inactiveOrEmptyShops = shopRows.filter(shop => shop.active_users === 0 || shop.suspended);
  const totalActiveSessions = sessionStates.filter(session => session.active).length;
  const activeUsers = users.filter(user => user.active).length;
  const inactiveUsers = users.length - activeUsers;
  const starterShops = shopRows.length - paidShops.length;
  const proShops = paidShops.length;
  const nowMs = Date.now();
  const sevenDaysMs = PLAN_EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000;
  const growthWindowMs = RECENT_GROWTH_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const signupWindowMs = RECENT_SIGNUP_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const inactivePaidWindowMs = INACTIVE_PAID_SHOP_DAYS * 24 * 60 * 60 * 1000;
  const proMonthlyShops = paidShops.filter(shop => String(shop.plan_billing_cycle || 'monthly') === 'monthly');
  const proAnnualShops = paidShops.filter(shop => String(shop.plan_billing_cycle || '') === 'annual');
  const estimatedMrr = (proMonthlyShops.length * PRO_MONTHLY_PRICE_NAIRA) + (proAnnualShops.length * (PRO_ANNUAL_PRICE_NAIRA / 12));
  const estimatedArr = (proMonthlyShops.length * PRO_MONTHLY_PRICE_NAIRA * 12) + (proAnnualShops.length * PRO_ANNUAL_PRICE_NAIRA);
  const newShops7d = shopRows.filter(shop => shop.created_at && (nowMs - new Date(shop.created_at).getTime()) <= signupWindowMs);
  const newShops30d = shopRows.filter(shop => shop.created_at && (nowMs - new Date(shop.created_at).getTime()) <= growthWindowMs);
  const expiringPaidShops = paidShops.filter(shop => {
    if (!shop.plan_expires_at) return false;
    const expiryMs = new Date(shop.plan_expires_at).getTime();
    return expiryMs >= nowMs && expiryMs <= nowMs + sevenDaysMs;
  });
  const inactivePaidShops = paidShops.filter(shop => {
    if (shop.suspended) return true;
    if ((shop.live_users || 0) > 0) return false;
    if (!shop.last_activity_at) return true;
    return (nowMs - new Date(shop.last_activity_at).getTime()) > inactivePaidWindowMs;
  });
  const seatLimitShops = shopRows.filter(shop => (shop.active_users || 0) >= planStaffLimit(String(shop.plan || 'free')));
  const noAdminShops = shopRows.filter(shop => (shop.admin_users || 0) === 0);
  const highSessionShops = shopRows.filter(shop => (shop.live_sessions || 0) >= HIGH_SESSION_ALERT_THRESHOLD);
  const firstSubscriptionByShop = new Map<string, string>();
  billingTransactions.forEach(tx => {
    const shopId = tx.shop_id ? String(tx.shop_id) : '';
    const createdAt = tx.created_at ? String(tx.created_at) : '';
    if (!shopId || !createdAt || firstSubscriptionByShop.has(shopId)) return;
    firstSubscriptionByShop.set(shopId, createdAt);
  });
  const proConversions30d = [...firstSubscriptionByShop.values()].filter(createdAt => (nowMs - new Date(createdAt).getTime()) <= growthWindowMs).length;
  const subscriptionEvents30d = billingTransactions.filter(tx => tx.created_at && (nowMs - new Date(String(tx.created_at)).getTime()) <= growthWindowMs).length;
  const conversionRate = shopRows.length ? Math.round((paidShops.length / shopRows.length) * 100) : 0;
  const alerts = [
    ...expiringPaidShops.map(shop => ({
      type: 'plan_expiry',
      severity: 'high',
      shop_id: shop.id,
      shop_name: shop.name,
      title: `${shop.name} plan expires soon`,
      body: `Pro plan expires on ${shop.plan_expires_at}.`,
    })),
    ...inactivePaidShops.map(shop => ({
      type: 'inactive_paid',
      severity: 'medium',
      shop_id: shop.id,
      shop_name: shop.name,
      title: `${shop.name} is a quiet paid shop`,
      body: shop.last_activity_at
        ? `No staff activity recorded since ${shop.last_activity_at}.`
        : 'No recent shop activity recorded for this paid shop.',
    })),
    ...seatLimitShops.map(shop => ({
      type: 'seat_limit',
      severity: String(shop.plan || 'free').toLowerCase() === 'pro' ? 'medium' : 'high',
      shop_id: shop.id,
      shop_name: shop.name,
      title: `${shop.name} reached the ${planStaffLimit(String(shop.plan || 'free'))}-user seat limit`,
      body: `${shop.active_users || 0} active users on ${String(shop.plan || 'free').toLowerCase() === 'pro' ? 'Pro' : 'Starter'}.`,
    })),
    ...highSessionShops.map(shop => ({
      type: 'high_sessions',
      severity: 'medium',
      shop_id: shop.id,
      shop_name: shop.name,
      title: `${shop.name} has unusually high live sessions`,
      body: `${shop.live_sessions || 0} live sessions across ${shop.live_users || 0} signed-in users.`,
    })),
    ...noAdminShops.map(shop => ({
      type: 'no_admin',
      severity: 'high',
      shop_id: shop.id,
      shop_name: shop.name,
      title: `${shop.name} has no shop admin`,
      body: 'No Admin role is currently linked to this shop.',
    })),
  ]
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || String(a.shop_name || '').localeCompare(String(b.shop_name || '')))
    .slice(0, 12);
  const billingGrowth = {
    estimated_mrr: estimatedMrr,
    estimated_arr: estimatedArr,
    pro_monthly_shops: proMonthlyShops.length,
    pro_annual_shops: proAnnualShops.length,
    new_shops_7d: newShops7d.length,
    new_shops_30d: newShops30d.length,
    pro_conversions_30d: proConversions30d,
    subscription_events_30d: subscriptionEvents30d,
    expiring_paid_shops_7d: expiringPaidShops.length,
    inactive_paid_shops: inactivePaidShops.length,
    conversion_rate: conversionRate,
  };
  const ownerAuditLog = (ownerAuditLogsRes.data || []).map(row => {
    const changes = parseChanges(row.changes) as Record<string, unknown>;
    const targetType = changes?.target_type ? String(changes.target_type) : null;
    const targetId = changes?.target_id ? String(changes.target_id) : String(row.record_id || '');
    const resolvedShopId = changes?.shop_id
      ? String(changes.shop_id)
      : (targetType === 'shop' ? targetId : null);
    const resolvedShopName = resolvedShopId
      ? (shopById.get(resolvedShopId)?.name || null)
      : (changes?.shop_name ? String(changes.shop_name) : null);
    const targetName = changes?.target_name
      ? String(changes.target_name)
      : (resolvedShopName || targetId || 'Unknown target');

    return {
      id: row.id,
      action: String(row.action || ''),
      action_label: actionLabel(String(row.action || '')),
      created_at: row.created_at ? String(row.created_at) : null,
      actor_id: row.changed_by ? String(row.changed_by) : null,
      actor_name: row.changed_by ? (userNameById.get(String(row.changed_by)) || 'Platform Owner') : 'Platform Owner',
      target_type: targetType,
      target_id: targetId || null,
      target_name: targetName,
      shop_id: resolvedShopId,
      shop_name: resolvedShopName,
      reason: changes?.reason ? String(changes.reason) : null,
      parsed_changes: changes,
    };
  });

  return {
    summary: {
      total_users: users.length,
      active_users: activeUsers,
      inactive_users: inactiveUsers,
      owner_users: users.filter(user => user.is_owner).length,
      total_shops: shopRows.length,
      starter_shops: starterShops,
      pro_shops: proShops,
      total_shop_admins: shopAdminUsers.length,
      total_staff_accounts: staffAccounts.length,
      active_shops: activeShops.length,
      inactive_or_empty_shops: inactiveOrEmptyShops.length,
      suspended_shops: suspendedShops.length,
      paid_shops: paidShops.length,
      active_sessions: totalActiveSessions,
      signed_in_users: signedInUsers.length,
      estimated_mrr: estimatedMrr,
      new_shops_30d: newShops30d.length,
      pro_conversions_30d: proConversions30d,
      expiring_paid_shops_7d: expiringPaidShops.length,
      recent_signups: users.slice(0, 8),
    },
    users,
    signed_in_users: signedInUsers,
    billing_growth: billingGrowth,
    alerts,
    owner_audit_log: ownerAuditLog,
    shops: shopRows,
    generated_at: new Date().toISOString(),
  };
}

async function revokeActiveSessions(adminClient: ReturnType<typeof createClient>, ownerId: string, targetUserIds: string[]) {
  const ids = [...new Set(targetUserIds.map(value => String(value || '').trim()).filter(Boolean))];
  if (!ids.length) return 0;

  const { data: rows, error } = await adminClient
    .from('audit_logs')
    .select('record_id, changed_by, action, created_at, changes')
    .eq('table_name', SESSION_TABLE)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  const idSet = new Set(ids);
  const sessions = buildSessionStates(rows || []);
  const targetSessionIds = sessions
    .filter(session => session.userId && idSet.has(session.userId) && session.active)
    .map(session => session.sessionId);

  if (!targetSessionIds.length) return 0;

  await insertAuditRows(adminClient, targetSessionIds.map(sessionId => ({
    table_name: SESSION_TABLE,
    record_id: sessionId,
    action: ACTION_REVOKE,
    changed_by: ownerId,
    changes: JSON.stringify({
      revoked_at: new Date().toISOString(),
      revoked_by_owner: true,
    }),
  })));

  return targetSessionIds.length;
}

async function logOwnerAction(adminClient: ReturnType<typeof createClient>, ownerId: string, action: string, recordId: string, changes: Record<string, unknown>) {
  await insertAuditRows(adminClient, [{
    table_name: PLATFORM_AUDIT_TABLE,
    record_id: recordId,
    action,
    changed_by: ownerId,
    changes: JSON.stringify(changes),
  }]);
}

async function revokeUserSessions(adminClient: ReturnType<typeof createClient>, ownerId: string, targetUserId: string) {
  return revokeActiveSessions(adminClient, ownerId, [targetUserId]);
}

async function updateUserActive(adminClient: ReturnType<typeof createClient>, ownerId: string, targetUserId: string, active: boolean) {
  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('id, email, role, full_name, active, shop_id')
    .eq('id', targetUserId)
    .maybeSingle();

  if (profileError) throw new Error(profileError.message);
  if (!profile) throw new Error('User profile not found.');

  const { data: authUserRes, error: authUserError } = await adminClient.auth.admin.getUserById(targetUserId);
  if (authUserError) throw new Error(authUserError.message);
  if (isPlatformOwner(authUserRes?.user || null, profile)) throw new Error('Owner accounts cannot be changed from this panel.');

  const { data: shop } = profile.shop_id
    ? await adminClient.from('shops').select('name').eq('id', profile.shop_id).maybeSingle()
    : { data: null };

  const { error: updateError } = await adminClient
    .from('profiles')
    .update({ active })
    .eq('id', targetUserId);

  if (updateError) throw new Error(updateError.message);

  const revokedSessions = active ? 0 : await revokeUserSessions(adminClient, ownerId, targetUserId);
  const auditAction = active ? PLATFORM_USER_REACTIVATE_ACTION : PLATFORM_USER_DEACTIVATE_ACTION;

  await logOwnerAction(adminClient, ownerId, auditAction, targetUserId, {
    target_type: 'user',
    target_id: targetUserId,
    target_name: profile.full_name || profile.email || targetUserId,
    target_email: profile.email || null,
    shop_id: profile.shop_id || null,
    shop_name: shop?.name || null,
    active,
    revoked_sessions: revokedSessions,
  });

  return {
    success: true,
    user_id: targetUserId,
    active,
    revoked_sessions: revokedSessions,
  };
}

async function setShopSuspended(adminClient: ReturnType<typeof createClient>, ownerId: string, shopId: string, suspended: boolean, reason = '') {
  const { data: shop, error: shopError } = await adminClient
    .from('shops')
    .select('id, name, plan, created_at, plan_expires_at')
    .eq('id', shopId)
    .maybeSingle();

  if (shopError) throw new Error(shopError.message);
  if (!shop) throw new Error('Shop not found.');

  const { data: profiles, error: profilesError } = await adminClient
    .from('profiles')
    .select('id, full_name, role, email, active')
    .eq('shop_id', shopId);

  if (profilesError) throw new Error(profilesError.message);

  const staffProfiles = (profiles || []).filter(profile => !isPlatformOwner(null, profile));
  const revokedSessions = suspended
    ? await revokeActiveSessions(adminClient, ownerId, staffProfiles.map(profile => String(profile.id)))
    : 0;

  const action = suspended ? SHOP_SUSPEND_ACTION : SHOP_UNSUSPEND_ACTION;
  const changes = {
    target_type: 'shop',
    target_id: shopId,
    target_name: shop.name || 'Unnamed Shop',
    shop_id: shopId,
    shop_name: shop.name || 'Unnamed Shop',
    reason: reason ? String(reason).trim() : null,
    suspended,
    affected_users: staffProfiles.length,
    revoked_sessions: revokedSessions,
  };

  await insertAuditRows(adminClient, [{
    table_name: 'shops',
    record_id: shopId,
    action,
    changed_by: ownerId,
    changes: JSON.stringify(changes),
  }]);

  await logOwnerAction(adminClient, ownerId, action, shopId, changes);

  return {
    success: true,
    shop_id: shopId,
    suspended,
    revoked_sessions: revokedSessions,
  };
}

async function setShopPlan(adminClient: ReturnType<typeof createClient>, ownerId: string, shopId: string, plan: string, billingCycle: string) {
  const { data: shop, error: shopError } = await adminClient
    .from('shops')
    .select('id, name, plan, plan_billing_cycle, created_at, plan_expires_at')
    .eq('id', shopId)
    .maybeSingle();

  if (shopError) throw new Error(shopError.message);
  if (!shop) throw new Error('Shop not found.');

  const nextPlan = normalizePlan(plan);
  const nextCycle = normalizeBillingCycle(billingCycle);
  const currentExpiryMs = shop.plan_expires_at ? new Date(String(shop.plan_expires_at)).getTime() : 0;
  const hasActivePaidPeriod = currentExpiryMs > Date.now();
  let nextExpiry: string | null = null;

  if (nextPlan === 'pro') {
    if (hasActivePaidPeriod) nextExpiry = String(shop.plan_expires_at);
    else nextExpiry = addBillingCycle(new Date(), nextCycle).toISOString();
  }

  const updatePayload = nextPlan === 'pro'
    ? {
        plan: 'pro',
        plan_billing_cycle: nextCycle,
        plan_expires_at: nextExpiry,
      }
    : {
        plan: 'free',
        plan_billing_cycle: null,
        plan_expires_at: null,
      };

  const { error: updateError } = await adminClient
    .from('shops')
    .update(updatePayload)
    .eq('id', shopId);

  if (updateError) throw new Error(updateError.message);

  await logOwnerAction(adminClient, ownerId, SHOP_PLAN_UPDATE_ACTION, shopId, {
    target_type: 'shop',
    target_id: shopId,
    target_name: shop.name || 'Unnamed Shop',
    shop_id: shopId,
    shop_name: shop.name || 'Unnamed Shop',
    previous_plan: shop.plan || 'free',
    previous_billing_cycle: shop.plan_billing_cycle || null,
    previous_plan_expires_at: shop.plan_expires_at || null,
    next_plan: updatePayload.plan,
    next_billing_cycle: updatePayload.plan_billing_cycle,
    next_plan_expires_at: updatePayload.plan_expires_at,
  });

  return {
    success: true,
    shop_id: shopId,
    plan: updatePayload.plan,
    billing_cycle: updatePayload.plan_billing_cycle,
    plan_expires_at: updatePayload.plan_expires_at,
  };
}

async function extendShopPlan(adminClient: ReturnType<typeof createClient>, ownerId: string, shopId: string, days: number) {
  const { data: shop, error: shopError } = await adminClient
    .from('shops')
    .select('id, name, plan, plan_billing_cycle, created_at, plan_expires_at')
    .eq('id', shopId)
    .maybeSingle();

  if (shopError) throw new Error(shopError.message);
  if (!shop) throw new Error('Shop not found.');
  if (normalizePlan(shop.plan) !== 'pro') throw new Error('Only Pro shops can have their plan expiry extended.');

  const extensionDays = positiveWholeNumber(days);
  if (!extensionDays) throw new Error('A valid number of extension days is required.');
  if (extensionDays > 3650) throw new Error('Extension is too large. Please use 3650 days or fewer.');

  const baseDate = shop.plan_expires_at && new Date(String(shop.plan_expires_at)).getTime() > Date.now()
    ? new Date(String(shop.plan_expires_at))
    : new Date();
  const nextExpiry = addDays(baseDate, extensionDays).toISOString();

  const { error: updateError } = await adminClient
    .from('shops')
    .update({ plan_expires_at: nextExpiry })
    .eq('id', shopId);

  if (updateError) throw new Error(updateError.message);

  await logOwnerAction(adminClient, ownerId, SHOP_PLAN_EXTEND_ACTION, shopId, {
    target_type: 'shop',
    target_id: shopId,
    target_name: shop.name || 'Unnamed Shop',
    shop_id: shopId,
    shop_name: shop.name || 'Unnamed Shop',
    plan: shop.plan || 'free',
    billing_cycle: shop.plan_billing_cycle || null,
    days_extended: extensionDays,
    previous_plan_expires_at: shop.plan_expires_at || null,
    next_plan_expires_at: nextExpiry,
  });

  return {
    success: true,
    shop_id: shopId,
    days_extended: extensionDays,
    plan_expires_at: nextExpiry,
  };
}

async function countRows(queryPromise: Promise<{ count: number | null; error: { message: string } | null }>) {
  const { count, error } = await queryPromise;
  if (error) throw new Error(error.message);
  return count || 0;
}

async function getShopDetail(adminClient: ReturnType<typeof createClient>, shopId: string) {
  const { data: shop, error: shopError } = await adminClient
    .from('shops')
    .select('id, name, address, phone, email, plan, plan_billing_cycle, created_at, plan_expires_at')
    .eq('id', shopId)
    .maybeSingle();

  if (shopError) throw new Error(shopError.message);
  if (!shop) throw new Error('Shop not found.');

  const [profilesRes, shopStatusLogsRes, sessionLogsRes, recentOwnerActionsRes, subscriptionTransactionsRes, customerCount, workOrderCount, invoiceCount, appointmentCount, inventoryCount, supplierCount, purchaseOrderCount, unreadNotificationCount] = await Promise.all([
    adminClient.from('profiles').select('id, full_name, role, email, active').eq('shop_id', shopId).order('full_name'),
    adminClient.from('audit_logs')
      .select('record_id, changed_by, action, created_at, changes')
      .eq('table_name', 'shops')
      .eq('record_id', shopId)
      .in('action', [SHOP_SUSPEND_ACTION, SHOP_UNSUSPEND_ACTION])
      .order('created_at', { ascending: false }),
    adminClient.from('audit_logs')
      .select('record_id, changed_by, action, created_at, changes')
      .eq('table_name', SESSION_TABLE)
      .order('created_at', { ascending: false }),
    adminClient.from('audit_logs')
      .select('id, record_id, changed_by, action, created_at, changes')
      .eq('table_name', PLATFORM_AUDIT_TABLE)
      .order('created_at', { ascending: false })
      .limit(20),
    adminClient.from('billing_transactions')
      .select('gross_amount, plan_cycle, created_at, status, type')
      .eq('shop_id', shopId)
      .eq('type', 'subscription')
      .eq('status', 'success')
      .order('created_at', { ascending: false }),
    countRows(adminClient.from('customers').select('id', { count: 'exact', head: true }).eq('shop_id', shopId)),
    countRows(adminClient.from('work_orders').select('id', { count: 'exact', head: true }).eq('shop_id', shopId)),
    countRows(adminClient.from('invoices').select('id', { count: 'exact', head: true }).eq('shop_id', shopId)),
    countRows(adminClient.from('appointments').select('id', { count: 'exact', head: true }).eq('shop_id', shopId)),
    countRows(adminClient.from('inventory').select('id', { count: 'exact', head: true }).eq('shop_id', shopId)),
    countRows(adminClient.from('suppliers').select('id', { count: 'exact', head: true }).eq('shop_id', shopId)),
    countRows(adminClient.from('purchase_orders').select('id', { count: 'exact', head: true }).eq('shop_id', shopId)),
    countRows(adminClient.from('notifications').select('id', { count: 'exact', head: true }).eq('shop_id', shopId).eq('read', false)),
  ]);

  if (profilesRes.error) throw new Error(profilesRes.error.message);
  if (shopStatusLogsRes.error) throw new Error(shopStatusLogsRes.error.message);
  if (sessionLogsRes.error) throw new Error(sessionLogsRes.error.message);
  if (recentOwnerActionsRes.error) throw new Error(recentOwnerActionsRes.error.message);
  if (subscriptionTransactionsRes.error) throw new Error(subscriptionTransactionsRes.error.message);

  const staffProfiles = profilesRes.data || [];
  const staffIds = staffProfiles.map(profile => String(profile.id));
  const authUsers = await listAllAuthUsers(adminClient);
  const authUserById = new Map(authUsers.map(user => [user.id, user]));
  const sessionStates = buildSessionStates(sessionLogsRes.data || []);
  const sessionSummaryByUser = buildActiveSessionSummaryByUser(sessionStates);
  const suspensionState = buildShopSuspensionMap(shopStatusLogsRes.data || []).get(shopId) || {
    suspended: false,
    action: null,
    updated_at: null,
    changed_by: null,
    reason: null,
  };

  const staff = staffProfiles
    .map(profile => {
      const authUser = authUserById.get(profile.id);
      const sessionSummary = sessionSummaryByUser.get(profile.id);
      return {
        id: profile.id,
        full_name: profile.full_name || profile.email || 'Unknown User',
        email: profile.email || null,
        role: isPlatformOwner(authUser || null, profile) ? 'Owner' : (profile.role || 'User'),
        active: profile.active !== false,
        last_sign_in_at: authUser?.last_sign_in_at || null,
        session_count: sessionSummary?.session_count || 0,
        last_active_at: sessionSummary?.last_active_at || null,
      };
    })
    .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));

  const userNameById = new Map(staff.map(profile => [profile.id, profile.full_name || profile.email || 'Unknown User']));
  let recentShopActivity: Array<Record<string, unknown>> = [];
  if (staffIds.length) {
    const { data: activityRows, error: activityError } = await adminClient
      .from('audit_logs')
      .select('id, table_name, record_id, action, changed_by, changes, created_at')
      .in('changed_by', staffIds)
      .neq('table_name', SESSION_TABLE)
      .order('created_at', { ascending: false })
      .limit(10);
    if (activityError) throw new Error(activityError.message);
    recentShopActivity = (activityRows || []).map(row => ({
      id: row.id,
      table_name: row.table_name,
      record_id: row.record_id,
      action: row.action,
      created_at: row.created_at,
      actor_id: row.changed_by,
      actor_name: row.changed_by ? (userNameById.get(String(row.changed_by)) || 'Unknown User') : 'Unknown User',
      parsed_changes: parseChanges(row.changes),
    }));
  }

  const recentOwnerActions = (recentOwnerActionsRes.data || [])
    .map(row => {
      const changes = parseChanges(row.changes) as Record<string, unknown>;
      const targetShopId = changes?.shop_id ? String(changes.shop_id) : (changes?.target_type === 'shop' ? String(changes?.target_id || row.record_id || '') : null);
      if (targetShopId !== shopId) return null;
      return {
        id: row.id,
        action: String(row.action || ''),
        action_label: actionLabel(String(row.action || '')),
        created_at: row.created_at ? String(row.created_at) : null,
        actor_id: row.changed_by ? String(row.changed_by) : null,
        actor_name: row.changed_by ? (userNameById.get(String(row.changed_by)) || 'Platform Owner') : 'Platform Owner',
        target_name: changes?.target_name ? String(changes.target_name) : (shop.name || 'Unnamed Shop'),
        reason: changes?.reason ? String(changes.reason) : null,
        parsed_changes: changes,
      };
    })
    .filter(Boolean);

  const liveUserCount = staff.filter(profile => (profile.session_count || 0) > 0).length;
  const liveSessionCount = staff.reduce((sum, profile) => sum + Number(profile.session_count || 0), 0);
  const adminCount = staff.filter(profile => profile.role === 'Admin' && profile.active).length;
  const lastShopActivityAt = recentShopActivity[0]?.created_at ? String(recentShopActivity[0].created_at) : null;
  const seatLimit = planStaffLimit(shop.plan);
  const remainingSeats = Math.max(seatLimit - staff.filter(profile => profile.active).length, 0);
  const subscriptionTransactions = subscriptionTransactionsRes.data || [];
  const lastSubscription = subscriptionTransactions[0] || null;
  const totalSubscriptionRevenue = subscriptionTransactions.reduce((sum, row) => sum + Number(row.gross_amount || 0), 0);
  const estimatedMonthlyValue = normalizePlan(shop.plan) === 'pro'
    ? (normalizeBillingCycle(shop.plan_billing_cycle) === 'annual'
      ? PRO_ANNUAL_PRICE_NAIRA / 12
      : PRO_MONTHLY_PRICE_NAIRA)
    : 0;
  const isPaid = isActiveProShop(shop);
  const nowMs = Date.now();
  const expiryMs = shop.plan_expires_at ? new Date(String(shop.plan_expires_at)).getTime() : 0;
  const expiringSoon = isPaid && expiryMs > nowMs && expiryMs <= (nowMs + (PLAN_EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000));
  const quietPaid = isPaid && (
    suspensionState.suspended
    || !lastShopActivityAt
    || (nowMs - new Date(lastShopActivityAt).getTime()) > (INACTIVE_PAID_SHOP_DAYS * 24 * 60 * 60 * 1000)
  );
  const atSeatLimit = staff.filter(profile => profile.active).length >= seatLimit;
  const riskAlerts = [
    ...(expiringSoon ? [{
      type: 'plan_expiry',
      severity: 'high',
      title: 'Plan expires soon',
      body: `This Pro plan is due to expire on ${shop.plan_expires_at}.`,
    }] : []),
    ...(quietPaid ? [{
      type: 'inactive_paid',
      severity: 'medium',
      title: 'Quiet paid shop',
      body: lastShopActivityAt
        ? `No staff activity recorded since ${lastShopActivityAt}.`
        : 'No recent staff activity has been recorded for this paid shop.',
    }] : []),
    ...(atSeatLimit ? [{
      type: 'seat_limit',
      severity: normalizePlan(shop.plan) === 'pro' ? 'medium' : 'high',
      title: 'Seat limit reached',
      body: `${staff.filter(profile => profile.active).length} active users are already on this ${normalizePlan(shop.plan) === 'pro' ? 'Pro' : 'Starter'} plan.`,
    }] : []),
    ...(liveSessionCount >= HIGH_SESSION_ALERT_THRESHOLD ? [{
      type: 'high_sessions',
      severity: 'medium',
      title: 'High session activity',
      body: `${liveSessionCount} live sessions are currently active for this shop.`,
    }] : []),
    ...(adminCount === 0 ? [{
      type: 'no_admin',
      severity: 'high',
      title: 'No shop admin linked',
      body: 'This shop currently has no active Admin account.',
    }] : []),
  ];

  return {
    shop: {
      ...shop,
      suspended: !!suspensionState.suspended,
      suspended_at: suspensionState.updated_at || null,
      suspension_reason: suspensionState.reason || null,
    },
    metrics: {
      staff_accounts: staff.length,
      active_staff: staff.filter(profile => profile.active).length,
      signed_in_users: staff.filter(profile => (profile.session_count || 0) > 0).length,
      live_sessions: liveSessionCount,
      customers: customerCount,
      work_orders: workOrderCount,
      invoices: invoiceCount,
      appointments: appointmentCount,
      inventory_items: inventoryCount,
      suppliers: supplierCount,
      purchase_orders: purchaseOrderCount,
      unread_notifications: unreadNotificationCount,
    },
    billing: {
      is_paid: isPaid,
      plan: normalizePlan(shop.plan),
      billing_cycle: normalizeBillingCycle(shop.plan_billing_cycle),
      plan_expires_at: shop.plan_expires_at || null,
      estimated_monthly_value: estimatedMonthlyValue,
      estimated_annual_value: estimatedMonthlyValue * 12,
      successful_subscription_payments: subscriptionTransactions.length,
      total_subscription_revenue: totalSubscriptionRevenue,
      last_subscription_at: lastSubscription?.created_at ? String(lastSubscription.created_at) : null,
      seat_limit: seatLimit,
      remaining_seats: remainingSeats,
      at_seat_limit: atSeatLimit,
    },
    staff,
    alerts: riskAlerts,
    recent_activity: recentShopActivity,
    recent_owner_actions: recentOwnerActions,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    const { user } = await getRequester(adminClient, req);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || 'overview');

    if (action === 'overview') {
      return json(await getOverview(adminClient));
    }

    if (action === 'shop_detail') {
      const shopId = String(body?.shop_id || '').trim();
      if (!shopId) return json({ error: 'shop_id is required' }, 400);
      return json(await getShopDetail(adminClient, shopId));
    }

    if (action === 'set_user_active') {
      const userId = String(body?.user_id || '').trim();
      if (!userId) return json({ error: 'user_id is required' }, 400);
      return json(await updateUserActive(adminClient, user.id, userId, !!body?.active));
    }

    if (action === 'revoke_user_sessions') {
      const userId = String(body?.user_id || '').trim();
      if (!userId) return json({ error: 'user_id is required' }, 400);

      const { data: authUserRes, error: authUserError } = await adminClient.auth.admin.getUserById(userId);
      if (authUserError) throw new Error(authUserError.message);
      const { data: profile } = await adminClient
        .from('profiles')
        .select('email, full_name, role, shop_id')
        .eq('id', userId)
        .maybeSingle();
      if (isPlatformOwner(authUserRes?.user || null, profile || null)) {
        return json({ error: 'Owner accounts cannot be changed from this panel.' }, 403);
      }

      const revokedCount = await revokeUserSessions(adminClient, user.id, userId);
      const { data: shop } = profile?.shop_id
        ? await adminClient.from('shops').select('name').eq('id', profile.shop_id).maybeSingle()
        : { data: null };
      await logOwnerAction(adminClient, user.id, PLATFORM_REVOKE_USER_SESSIONS_ACTION, userId, {
        target_type: 'user',
        target_id: userId,
        target_name: profile?.full_name || profile?.email || userId,
        target_email: profile?.email || null,
        shop_id: profile?.shop_id || null,
        shop_name: shop?.name || null,
        revoked_sessions: revokedCount,
      });
      return json({ success: true, user_id: userId, revoked_sessions: revokedCount });
    }

    if (action === 'set_shop_suspended') {
      const shopId = String(body?.shop_id || '').trim();
      if (!shopId) return json({ error: 'shop_id is required' }, 400);
      return json(await setShopSuspended(adminClient, user.id, shopId, !!body?.suspended, String(body?.reason || '').trim()));
    }

    if (action === 'set_shop_plan') {
      const shopId = String(body?.shop_id || '').trim();
      if (!shopId) return json({ error: 'shop_id is required' }, 400);
      return json(await setShopPlan(
        adminClient,
        user.id,
        shopId,
        String(body?.plan || 'free'),
        String(body?.billing_cycle || 'monthly'),
      ));
    }

    if (action === 'extend_shop_plan') {
      const shopId = String(body?.shop_id || '').trim();
      if (!shopId) return json({ error: 'shop_id is required' }, 400);
      return json(await extendShopPlan(
        adminClient,
        user.id,
        shopId,
        positiveWholeNumber(body?.days),
      ));
    }

    return json({ error: 'Unsupported action' }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    const status = message === 'Owner access required' ? 403 : (message === 'No token' || message === 'Invalid token' ? 401 : 500);
    return json({ error: message }, status);
  }
});
