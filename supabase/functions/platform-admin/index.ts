import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SESSION_TABLE = 'auth_sessions';
const ACTION_REVOKE = 'SESSION_REVOKE';
const ACTIVE_ACTIONS = new Set(['SESSION_START', 'SESSION_HEARTBEAT', 'SESSION_END']);
const ACTIVE_SESSION_WINDOW_MS = 35 * 60 * 1000;

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

function buildSessionStates(rows: Array<Record<string, unknown>>) {
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

async function getOverview(adminClient: ReturnType<typeof createClient>) {
  const [authUsers, profilesRes, shopsRes, sessionLogsRes] = await Promise.all([
    listAllAuthUsers(adminClient),
    adminClient.from('profiles').select('id, full_name, role, email, shop_id, active'),
    adminClient.from('shops').select('id, name, plan, created_at, plan_expires_at').order('created_at', { ascending: false }),
    adminClient.from('audit_logs').select('record_id, changed_by, action, created_at, changes').eq('table_name', SESSION_TABLE).order('created_at', { ascending: false }),
  ]);

  if (profilesRes.error) throw new Error(profilesRes.error.message);
  if (shopsRes.error) throw new Error(shopsRes.error.message);
  if (sessionLogsRes.error) throw new Error(sessionLogsRes.error.message);

  const profiles = profilesRes.data || [];
  const shops = shopsRes.data || [];
  const sessionStates = buildSessionStates(sessionLogsRes.data || []);

  const profileById = new Map(profiles.map(profile => [profile.id, profile]));
  const shopById = new Map(shops.map(shop => [shop.id, shop]));
  const authUserIds = new Set(authUsers.map(user => user.id));

  const activeSessionSummaryByUser = new Map<string, ActiveSessionSummary>();
  sessionStates.forEach(session => {
    if (!session.active || !session.userId) return;
    const current = activeSessionSummaryByUser.get(session.userId) || {
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

    activeSessionSummaryByUser.set(session.userId, current);
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
    shopUserStats.set(user.shop_id, current);
  });

  const shopRows = shops.map(shop => ({
    id: shop.id,
    name: shop.name || 'Unnamed Shop',
    plan: shop.plan || 'free',
    created_at: shop.created_at || null,
    plan_expires_at: shop.plan_expires_at || null,
    total_users: shopUserStats.get(shop.id)?.total_users || 0,
    active_users: shopUserStats.get(shop.id)?.active_users || 0,
    inactive_users: shopUserStats.get(shop.id)?.inactive_users || 0,
    admin_users: shopUserStats.get(shop.id)?.admin_users || 0,
  }));

  const nonOwnerUsers = users.filter(user => !user.is_owner);
  const shopAdminUsers = nonOwnerUsers.filter(user => user.role === 'Admin' && user.shop_id);
  const staffAccounts = nonOwnerUsers.filter(user => ['Mechanic', 'Service Advisor', 'Parts Manager'].includes(String(user.role || '')));
  const paidShops = shopRows.filter(shop => shop.plan === 'pro');
  const activeShops = shopRows.filter(shop => shop.active_users > 0);
  const inactiveOrEmptyShops = shopRows.filter(shop => shop.active_users === 0);
  const totalActiveSessions = sessionStates.filter(session => session.active).length;
  const activeUsers = users.filter(user => user.active).length;
  const inactiveUsers = users.length - activeUsers;
  const starterShops = shopRows.filter(shop => (shop.plan || 'free') !== 'pro').length;
  const proShops = shopRows.filter(shop => shop.plan === 'pro').length;

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
      paid_shops: paidShops.length,
      active_sessions: totalActiveSessions,
      signed_in_users: signedInUsers.length,
      recent_signups: users.slice(0, 8),
    },
    users,
    signed_in_users: signedInUsers,
    shops: shopRows,
    generated_at: new Date().toISOString(),
  };
}

async function revokeUserSessions(adminClient: ReturnType<typeof createClient>, ownerId: string, targetUserId: string) {
  const { data: rows, error } = await adminClient
    .from('audit_logs')
    .select('record_id, changed_by, action, created_at, changes')
    .eq('table_name', SESSION_TABLE)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  const sessions = buildSessionStates(rows || []);
  const targetSessionIds = sessions
    .filter(session => session.userId === targetUserId && session.active)
    .map(session => session.sessionId);

  if (!targetSessionIds.length) return 0;

  const revokeRows = targetSessionIds.map(sessionId => ({
    table_name: SESSION_TABLE,
    record_id: sessionId,
    action: ACTION_REVOKE,
    changed_by: ownerId,
    changes: JSON.stringify({
      revoked_at: new Date().toISOString(),
      revoked_by_owner: true,
    }),
  }));

  const { error: insertError } = await adminClient.from('audit_logs').insert(revokeRows);
  if (insertError) throw new Error(insertError.message);

  return targetSessionIds.length;
}

async function updateUserActive(adminClient: ReturnType<typeof createClient>, ownerId: string, targetUserId: string, active: boolean) {
  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('id, email, role, full_name, active')
    .eq('id', targetUserId)
    .maybeSingle();

  if (profileError) throw new Error(profileError.message);
  if (!profile) throw new Error('User profile not found.');

  const { data: authUserRes, error: authUserError } = await adminClient.auth.admin.getUserById(targetUserId);
  if (authUserError) throw new Error(authUserError.message);
  if (isPlatformOwner(authUserRes?.user || null, profile)) throw new Error('Owner accounts cannot be changed from this panel.');

  const { error: updateError } = await adminClient
    .from('profiles')
    .update({ active })
    .eq('id', targetUserId);

  if (updateError) throw new Error(updateError.message);

  const revokedSessions = active ? 0 : await revokeUserSessions(adminClient, ownerId, targetUserId);

  return {
    success: true,
    user_id: targetUserId,
    active,
    revoked_sessions: revokedSessions,
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
        .select('email, role')
        .eq('id', userId)
        .maybeSingle();
      if (isPlatformOwner(authUserRes?.user || null, profile || null)) {
        return json({ error: 'Owner accounts cannot be changed from this panel.' }, 403);
      }

      const revokedCount = await revokeUserSessions(adminClient, user.id, userId);
      return json({ success: true, user_id: userId, revoked_sessions: revokedCount });
    }

    return json({ error: 'Unsupported action' }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    const status = message === 'Owner access required' ? 403 : (message === 'No token' || message === 'Invalid token' ? 401 : 500);
    return json({ error: message }, status);
  }
});
