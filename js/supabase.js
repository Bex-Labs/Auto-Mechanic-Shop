/* =================================================================
   GEARSHIFT — SUPABASE.JS
   Multi-tenant data layer — every query is scoped to the
   current user's shop_id so shops never see each other's data.

   HOW TO USE:
   1. Create a free project at https://supabase.com
   2. Run supabase_schema.sql in SQL Editor
   3. Copy your Project URL + anon key below
   4. In every HTML page replace data.js with:
        <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
        <script src="../js/supabase.js"></script>
   ================================================================= */

/* -----------------------------------------------------------------
   ⚙️  CONFIGURATION — replace these two values
   ----------------------------------------------------------------- */
const SUPABASE_URL  = 'https://tqwwnmgcvaqeigpodirc.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxd3dubWdjdmFxZWlncG9kaXJjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0Nzg5ODEsImV4cCI6MjA4ODA1NDk4MX0.mP5RNZ0Tu7ckrDkjCmrVcbnaMJ2Sf7QfuGCslElGLo0';
const SUPABASE_PROJECT_REF = (() => {
  try { return new URL(SUPABASE_URL).hostname.split('.')[0]; }
  catch { return 'gearshift'; }
})();
const SUPABASE_STORAGE_PREFIX = `sb-${SUPABASE_PROJECT_REF}-`;
const INACTIVITY_STORAGE_KEY = 'gs_last_activity_at';
const LOGIN_NOTICE_KEY = 'gs_login_notice';
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
const NOTIFICATION_PREFERENCE_STORAGE_PREFIX = 'gs_notification_preferences:';
const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
  app_low_stock_alerts: true,
  app_work_order_updates: true,
  app_new_booking_requests: true,
  app_po_delivery_confirmations: true,
  app_invoice_payments: true,
  email_daily_summary: true,
  email_overdue_invoices: true,
  email_supplier_delivery: false,
});
const NOTIFICATION_TYPE_PREFERENCE_KEY = Object.freeze({
  low_stock: 'app_low_stock_alerts',
  wo_update: 'app_work_order_updates',
  appointment: 'app_new_booking_requests',
  po_update: 'app_po_delivery_confirmations',
  payment: 'app_invoice_payments',
});

function _authSessionStorage() {
  return {
    getItem(key) {
      try { return window.sessionStorage.getItem(key); }
      catch { return null; }
    },
    setItem(key, value) {
      try { window.sessionStorage.setItem(key, value); }
      catch {}
    },
    removeItem(key) {
      try { window.sessionStorage.removeItem(key); }
      catch {}
    },
  };
}

function _clearLegacySupabaseStorage() {
  try {
    if (!window.localStorage) return;
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(SUPABASE_STORAGE_PREFIX)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {}
}

function _setLoginNotice(reason) {
  try {
    if (reason) window.sessionStorage.setItem(LOGIN_NOTICE_KEY, reason);
    else window.sessionStorage.removeItem(LOGIN_NOTICE_KEY);
  } catch {}
}

_clearLegacySupabaseStorage();

/* -----------------------------------------------------------------
   CLIENT  (global `sb`)
   ----------------------------------------------------------------- */
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    autoRefreshToken:   true,
    persistSession:     true,
    detectSessionInUrl: true,
    storage:            _authSessionStorage(),
  },
});

/* =================================================================
   SHOP CONTEXT  — cached shop_id for the current session.
   Every GS query calls _shopId() to scope its results.
   Cache is cleared on sign-out so switching accounts works cleanly.
   ================================================================= */
let _cachedShopId = null;

async function _shopId() {
  if (_cachedShopId) return _cachedShopId;

  const { data: { user: authUser } } = await sb.auth.getUser();
  if (!authUser) throw new Error('Not authenticated');

  const { data: rows, error } = await sb.from('profiles')
    .select('shop_id')
    .eq('id', authUser.id)
    .limit(1);

  if (error || !rows?.length) throw new Error('Could not resolve shop for current user');

  const shopId = rows[0].shop_id;
  if (!shopId) throw new Error('Your account is not linked to a shop yet. Please complete registration.');

  _cachedShopId = shopId;
  return _cachedShopId;
}

function _clearShopCache() {
  _cachedShopId = null;
}

const SessionSecurity = (() => {
  const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'click', 'scroll', 'touchstart'];
  let _started = false;
  let _intervalId = null;
  let _activityHandler = null;
  let _visibilityHandler = null;
  let _expiring = false;

  function _touch() {
    try { window.sessionStorage.setItem(INACTIVITY_STORAGE_KEY, String(Date.now())); }
    catch {}
  }

  function _clearTouch() {
    try { window.sessionStorage.removeItem(INACTIVITY_STORAGE_KEY); }
    catch {}
  }

  function _lastActivity() {
    try { return Number(window.sessionStorage.getItem(INACTIVITY_STORAGE_KEY) || '0'); }
    catch { return 0; }
  }

  async function _expire() {
    if (_expiring) return;
    _expiring = true;
    try {
      await Auth.signOut({ reason: 'timeout' });
    } catch {}
    window.location.href = 'dashboard.html?timeout=1';
  }

  function check() {
    const last = _lastActivity();
    if (!last) {
      _touch();
      return;
    }
    if (Date.now() - last >= INACTIVITY_TIMEOUT_MS) {
      _expire();
    }
  }

  function start() {
    if (_started || typeof window === 'undefined') return;
    _started = true;
    _expiring = false;
    _touch();
    _activityHandler = () => _touch();
    _visibilityHandler = () => {
      if (!document.hidden) check();
    };
    ACTIVITY_EVENTS.forEach(eventName => {
      window.addEventListener(eventName, _activityHandler, { passive: true });
    });
    document.addEventListener('visibilitychange', _visibilityHandler);
    _intervalId = window.setInterval(check, 60000);
  }

  function stop() {
    if (typeof window === 'undefined') return;
    if (_activityHandler) {
      ACTIVITY_EVENTS.forEach(eventName => {
        window.removeEventListener(eventName, _activityHandler);
      });
    }
    if (_visibilityHandler) {
      document.removeEventListener('visibilitychange', _visibilityHandler);
    }
    if (_intervalId) {
      window.clearInterval(_intervalId);
    }
    _activityHandler = null;
    _visibilityHandler = null;
    _intervalId = null;
    _started = false;
    _expiring = false;
    _clearTouch();
  }

  return { start, stop, check };
})();

/* =================================================================
   AUTH MODULE
   ================================================================= */
const Auth = (() => {

  async function signIn(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    _clearShopCache();
    _setLoginNotice(null);
    SessionSecurity.start();
    return data;
  }

  async function signInWithGoogle() {
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.href.split('?')[0] }
    });
    if (error) throw error;
  }

  async function signUp(email, password, fullName, role) {
    if (!role) throw new Error('Role is required to create an account.');
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { data: { full_name: fullName, role } }
    });
    if (error) throw error;
    return data;
  }

  async function signOut(options = {}) {
    const reason = typeof options === 'string' ? options : options.reason;
    _clearShopCache();
    SessionSecurity.stop();
    _setLoginNotice(reason === 'timeout' ? 'timeout' : null);
    await sb.auth.signOut();
    _clearLegacySupabaseStorage();
  }

  async function getSession() {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      _setLoginNotice(null);
      SessionSecurity.start();
    } else {
      SessionSecurity.stop();
    }
    return session;
  }

  async function getUser() {
    const session = await getSession();
    if (!session) return null;

    const { data: rows, error } = await sb.from('profiles')
      .select('id, full_name, role, email, shop_id, avatar_url, speciality, active')
      .eq('id', session.user.id)
      .limit(1);

    const profile = rows?.[0] || null;
    if (error || !profile) {
      return {
        id: session.user.id,
        full_name: session.user.user_metadata?.full_name || session.user.email.split('@')[0],
        role: session.user.user_metadata?.role || 'Admin',
        shop_id: null,
        email: session.user.email,
      };
    }

    if (profile.shop_id) {
      _cachedShopId = profile.shop_id; // prime cache
      const { data: shop } = await sb.from('shops')
        .select('name').eq('id', profile.shop_id).single();
      profile.shop_name = shop?.name || null;
    }

    return profile;
  }

  async function resetPassword(email) {
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.href.split('?')[0] + '?reset=1'
    });
    if (error) throw error;
  }

  async function requireAuth() {
    const session = await getSession();
    if (!session) window.location.href = 'dashboard.html';
    return session;
  }

  async function requireRole(...roles) {
    const user = await getUser();
    if (!user || !roles.includes(user.role)) {
      Toast.show(`Access denied. Required role: ${roles.join(' or ')}`, 'error');
      return false;
    }
    return user;
  }

  function onAuthChange(callback) {
    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') _clearShopCache();
      if (session) {
        _setLoginNotice(null);
        SessionSecurity.start();
      } else {
        SessionSecurity.stop();
      }
      callback(event, session);
    });
  }

  return {
    signIn, signInWithGoogle, signUp, signOut,
    getSession, getUser, resetPassword,
    requireAuth, requireRole, onAuthChange,
  };
})();

/* =================================================================
   REALTIME MODULE — subscriptions filtered to current shop
   ================================================================= */
const Realtime = (() => {
  const channels = {};

  async function subscribe(table, { onInsert, onUpdate, onDelete } = {}) {
    const name = `realtime:${table}:${Date.now()}`;

    let shopFilter = null;
    try {
      const sid = await _shopId();
      if (sid) shopFilter = `shop_id=eq.${sid}`;
    } catch(e) { /* no shop yet — RLS will cover us */ }

    const baseOpts = shopFilter
      ? { schema: 'public', table, filter: shopFilter }
      : { schema: 'public', table };

    const channel = sb.channel(name)
      .on('postgres_changes', { event: 'INSERT', ...baseOpts }, p => { if (onInsert) onInsert(p.new); })
      .on('postgres_changes', { event: 'UPDATE', ...baseOpts }, p => { if (onUpdate) onUpdate(p.new, p.old); })
      .on('postgres_changes', { event: 'DELETE', ...baseOpts }, p => { if (onDelete) onDelete(p.old); })
      .subscribe();

    channels[name] = channel;
    return name;
  }

  function unsubscribe(name) {
    if (channels[name]) { sb.removeChannel(channels[name]); delete channels[name]; }
  }

  function unsubscribeAll() { Object.keys(channels).forEach(unsubscribe); }

  return { subscribe, unsubscribe, unsubscribeAll };
})();

/* =================================================================
   FORMAT HELPER  (used by getDashboardKPIs)
   ================================================================= */
function formatCurrency(amount) {
  return '\u20a6' + Number(amount || 0).toLocaleString('en-NG', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

/* =================================================================
   DATA MODULE  — every read filtered by shop_id,
                  every write injects shop_id
   ================================================================= */
const GS = (() => {

  function _jsonChanges(changes) {
    if (changes == null) return null;
    return typeof changes === 'string' ? changes : JSON.stringify(changes);
  }

  function _parseChanges(changes) {
    if (!changes) return null;
    if (typeof changes === 'object') return changes;
    try { return JSON.parse(changes); }
    catch { return { raw: String(changes) }; }
  }

  async function _audit(tableName, recordId, action, changes = null) {
    try {
      const { data: { session } } = await sb.auth.getSession();
      const actorId = session?.user?.id || null;
      await sb.from('audit_logs').insert({
        table_name: tableName,
        record_id: recordId || actorId,
        action,
        changed_by: actorId,
        changes: _jsonChanges(changes),
      });
    } catch (e) {
      console.warn('Audit log failed:', e);
    }
  }

  async function _actorAndStaffMap() {
    const sid = await _shopId();
    const { data, error } = await sb.from('profiles')
      .select('id, full_name, role, email')
      .eq('shop_id', sid)
      .order('full_name');
    if (error) throw error;

    const rows = data || [];
    const byId = {};
    rows.forEach(row => { byId[row.id] = row; });
    return { rows, byId };
  }

  async function getShopActivity(filters = {}) {
    const { rows: staffRows, byId: staffMap } = await _actorAndStaffMap();
    const staffIds = staffRows.map(row => row.id).filter(Boolean);
    if (!staffIds.length) return [];

    let q = sb.from('audit_logs')
      .select('id, table_name, record_id, action, changed_by, changes, created_at')
      .in('changed_by', staffIds)
      .order('created_at', { ascending: false })
      .limit(filters.limit || 250);

    if (filters.userId) q = q.eq('changed_by', filters.userId);

    if (filters.date) {
      const start = new Date(filters.date + 'T00:00:00');
      const end = new Date(filters.date + 'T23:59:59.999');
      q = q.gte('created_at', start.toISOString()).lte('created_at', end.toISOString());
    }

    const { data, error } = await q;
    if (error) throw error;

    return (data || []).map(row => ({
      ...row,
      actor_name: staffMap[row.changed_by]?.full_name || 'Unknown',
      actor_role: staffMap[row.changed_by]?.role || '—',
      actor_email: staffMap[row.changed_by]?.email || null,
      parsed_changes: _parseChanges(row.changes),
    }));
  }

  async function logPageView(pageKey, pageTitle = null) {
    const key = 'gs_page_view:' + pageKey;
    try {
      const lastSeen = sessionStorage.getItem(key);
      if (lastSeen && (Date.now() - Number(lastSeen)) < 5 * 60 * 1000) return;
      sessionStorage.setItem(key, String(Date.now()));
    } catch (e) {}

    const { data: { session } } = await sb.auth.getSession();
    const actorId = session?.user?.id;
    if (!actorId) return;

    await _audit('app_pages', actorId, 'PAGE_VIEW', {
      page_key: pageKey,
      page_title: pageTitle || pageKey,
      path: window.location.pathname,
    });
  }

  async function logActivity(tableName, recordId, action, changes = null) {
    await _audit(tableName, recordId, action, changes);
  }

  function _notificationPreferenceStorageKey(shopId) {
    return NOTIFICATION_PREFERENCE_STORAGE_PREFIX + (shopId || 'global');
  }

  function _parseNotificationPreferences(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); }
    catch { return {}; }
  }

  function _mergeNotificationPreferences(prefs = {}) {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...(prefs || {}) };
  }

  function _readStoredNotificationPreferences(shopId) {
    try {
      const raw = window.localStorage.getItem(_notificationPreferenceStorageKey(shopId));
      return _mergeNotificationPreferences(_parseNotificationPreferences(raw));
    } catch {
      return _mergeNotificationPreferences();
    }
  }

  function _writeStoredNotificationPreferences(shopId, prefs) {
    try {
      window.localStorage.setItem(
        _notificationPreferenceStorageKey(shopId),
        JSON.stringify(_mergeNotificationPreferences(prefs))
      );
    } catch {}
  }

  function _isNotificationVisibleWithPrefs(type, prefs) {
    const key = NOTIFICATION_TYPE_PREFERENCE_KEY[type];
    return key ? prefs[key] !== false : true;
  }

  async function getNotificationPreferences() {
    const sid = await _shopId();
    let prefs = _readStoredNotificationPreferences(sid);

    try {
      const settings = await getSettings();
      const dbPrefs = _parseNotificationPreferences(settings?.notification_preferences);
      if (Object.keys(dbPrefs).length) {
        prefs = _mergeNotificationPreferences({ ...prefs, ...dbPrefs });
        _writeStoredNotificationPreferences(sid, prefs);
      }
    } catch {}

    return prefs;
  }

  async function saveNotificationPreferences(prefs) {
    const sid = await _shopId();
    const merged = _mergeNotificationPreferences(prefs);

    _writeStoredNotificationPreferences(sid, merged);

    try {
      await updateSettings({ notification_preferences: merged });
    } catch (e) {
      console.warn('Notification preference DB sync skipped:', e.message);
    }

    return merged;
  }

  async function isNotificationEnabled(type) {
    const prefs = await getNotificationPreferences();
    return _isNotificationVisibleWithPrefs(type, prefs);
  }

  async function filterNotificationsByPreference(items) {
    const prefs = await getNotificationPreferences();
    return (items || []).filter(item => _isNotificationVisibleWithPrefs(item?.type, prefs));
  }

  async function _maybeCreateLowStockNotification(beforeItem, afterItem) {
    if (!afterItem?.id) return;

    const afterQty = Number(afterItem.qty || 0);
    const afterThreshold = Number(afterItem.threshold || 0);
    const beforeQty = Number(beforeItem?.qty);
    const beforeThreshold = Number(beforeItem?.threshold ?? afterThreshold);
    const beforeLow = Number.isFinite(beforeQty) ? beforeQty <= beforeThreshold : false;
    const afterLow = afterQty <= afterThreshold;

    if (!afterLow || beforeLow) return;

    const partName = afterItem.name || 'Inventory item';
    await createNotification({
      type: 'low_stock',
      title: `Low Stock Alert — ${partName}`,
      body: `${partName} has dropped to ${afterQty} unit${afterQty === 1 ? '' : 's'} with a reorder threshold of ${afterThreshold}.`,
      related_id: afterItem.id,
      related_type: 'inventory',
    });
  }

  /* ---------------------------------------------------------------
     CUSTOMERS
     --------------------------------------------------------------- */
  async function getCustomers() {
    const sid = await _shopId();
    const { data, error } = await sb.from('customers')
      .select('*').eq('shop_id', sid).order('last_name');
    if (error) throw error;
    return data;
  }

  async function getCustomer(id) {
    const sid = await _shopId();
    const { data, error } = await sb.from('customers')
      .select('*, vehicles(*)')
      .eq('id', id).eq('shop_id', sid).single();
    if (error) throw error;
    return data;
  }

  async function createCustomer(payload) {
    const sid = await _shopId();
    const { data, error } = await sb.from('customers')
      .insert({ ...payload, shop_id: sid }).select().single();
    if (error) throw error;
    await _audit('customers', data?.id, 'CREATE', {
      full_name: `${payload.first_name || ''} ${payload.last_name || ''}`.trim() || null,
      email: payload.email || null,
      phone: payload.phone || null,
    });
    return data;
  }

  async function updateCustomer(id, payload) {
    const sid = await _shopId();
    const { data, error } = await sb.from('customers')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id).eq('shop_id', sid).select();
    if (error) throw error;
    await _audit('customers', id, 'UPDATE', payload);
    return data?.[0];
  }

  async function deleteCustomer(id) {
    const sid = await _shopId();
    await _audit('customers', id, 'DELETE');
    const { error } = await sb.from('customers')
      .delete().eq('id', id).eq('shop_id', sid);
    if (error) throw error;
  }

  async function getAuditLog(tableName, recordId) {
    const { data, error } = await sb.from('audit_logs')
      .select('id, action, changes, created_at, changed_by')
      .eq('table_name', tableName).eq('record_id', recordId)
      .order('created_at', { ascending: false }).limit(20);
    if (error) return [];
    const rows = data || [];
    const userIds = [...new Set(rows.filter(r => r.changed_by).map(r => r.changed_by))];
    let nameMap = {};
    if (userIds.length) {
      const { data: profiles } = await sb.from('profiles').select('id, full_name').in('id', userIds);
      (profiles || []).forEach(p => { nameMap[p.id] = p.full_name; });
    }
    return rows.map(r => ({ ...r, changer_name: nameMap[r.changed_by] || 'Unknown' }));
  }

  /* ---------------------------------------------------------------
     VEHICLES  (belong to customers who belong to the shop)
     --------------------------------------------------------------- */
  async function getVehicles(customerId = null) {
    const sid = await _shopId();
    // Join through customers to scope to this shop
    let q = sb.from('vehicles')
      .select('*, customers!inner(id, first_name, last_name, shop_id)')
      .eq('customers.shop_id', sid)
      .order('year', { ascending: false });
    if (customerId) q = q.eq('customer_id', customerId);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }

  async function createVehicle(payload) {
    const { data, error } = await sb.from('vehicles').insert(payload).select();
    if (error) throw error;
    await _audit('vehicles', data?.[0]?.id, 'CREATE', payload);
    return data?.[0];
  }

  async function updateVehicle(id, payload) {
    const { data, error } = await sb.from('vehicles')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id).select();
    if (error) throw error;
    await _audit('vehicles', id, 'UPDATE', payload);
    return data?.[0];
  }

  async function deleteVehicle(id) {
    await _audit('vehicles', id, 'DELETE');
    const { error } = await sb.from('vehicles').delete().eq('id', id);
    if (error) throw error;
  }

  /* ---------------------------------------------------------------
     WORK ORDERS
     --------------------------------------------------------------- */
  async function getWorkOrders(filters = {}) {
    const sid = await _shopId();
    let q = sb.from('work_orders')
      .select('*').eq('shop_id', sid)
      .order('created_at', { ascending: false });
    if (filters.status)      q = q.eq('status', filters.status);
    if (filters.mechanic_id) q = q.eq('mechanic_id', filters.mechanic_id);
    if (filters.customer_id) q = q.eq('customer_id', filters.customer_id);
    const { data, error } = await q;
    if (error) throw error;

    const wos     = data || [];
    const custIds = [...new Set(wos.map(w => w.customer_id).filter(Boolean))];
    const vehIds  = [...new Set(wos.map(w => w.vehicle_id).filter(Boolean))];
    const mechIds = [...new Set(wos.map(w => w.mechanic_id).filter(Boolean))];
    const [custs, vehs, mechs] = await Promise.all([
      custIds.length ? sb.from('customers').select('id,first_name,last_name').in('id', custIds) : { data: [] },
      vehIds.length  ? sb.from('vehicles').select('id,year,make,model').in('id', vehIds)        : { data: [] },
      mechIds.length ? sb.from('profiles').select('id,full_name').in('id', mechIds)             : { data: [] },
    ]);
    const custMap = Object.fromEntries((custs.data||[]).map(c => [c.id, `${c.first_name} ${c.last_name}`]));
    const vehMap  = Object.fromEntries((vehs.data||[]).map(v => [v.id, `${v.year||''} ${v.make} ${v.model}`.trim()]));
    const mechMap = Object.fromEntries((mechs.data||[]).map(m => [m.id, m.full_name]));
    return wos.map(w => ({
      ...w,
      customer_name: custMap[w.customer_id] || '—',
      vehicle_label: vehMap[w.vehicle_id]   || '—',
      mechanic_name: mechMap[w.mechanic_id] || null,
    }));
  }

  async function getWorkOrder(id) {
    const sid = await _shopId();
    const { data: woRows, error: woErr } = await sb.from('work_orders')
      .select('*').eq('id', id).eq('shop_id', sid).limit(1);
    if (woErr) throw woErr;
    const wo = woRows?.[0];
    if (!wo) throw new Error('Work order not found');

    const [custRes, vehRes, mechRes, partsRes] = await Promise.all([
      wo.customer_id ? sb.from('customers').select('id,first_name,last_name').eq('id', wo.customer_id).limit(1) : { data: [] },
      wo.vehicle_id  ? sb.from('vehicles').select('id,year,make,model,vin,plate,mileage').eq('id', wo.vehicle_id).limit(1) : { data: [] },
      wo.mechanic_id ? sb.from('profiles').select('id,full_name').eq('id', wo.mechanic_id).limit(1) : { data: [] },
      sb.from('work_order_parts').select('id,qty,unit_cost,part_id').eq('work_order_id', id),
    ]);
    const cust  = custRes.data?.[0];
    const veh   = vehRes.data?.[0];
    const mech  = mechRes.data?.[0];
    const parts = partsRes.data || [];
    const partIds = parts.map(p => p.part_id).filter(Boolean);
    let invMap = {};
    if (partIds.length) {
      const { data: inv } = await sb.from('inventory').select('id,name,sku,cost').in('id', partIds);
      (inv||[]).forEach(i => { invMap[i.id] = i; });
    }
    return {
      ...wo,
      customer_name: cust ? `${cust.first_name} ${cust.last_name}` : '—',
      vehicle_label: veh  ? `${veh.year||''} ${veh.make} ${veh.model}`.trim() : '—',
      vehicle:       veh  || null,
      mechanic_name: mech?.full_name || null,
      parts: parts.map(p => ({ ...p, inventory: invMap[p.part_id] || null })),
    };
  }

  async function createWorkOrder(payload) {
    const sid = await _shopId();
    const { data, error } = await sb.from('work_orders')
      .insert({ ...payload, shop_id: sid, status: 'Open', ref: '' }).select();
    if (error) throw error;
    const wo = data?.[0];
    await _audit('work_orders', wo?.id, 'CREATE', {
      ref: wo?.ref || null,
      customer_id: payload.customer_id || null,
      vehicle_id: payload.vehicle_id || null,
      mechanic_id: payload.mechanic_id || null,
      fault: payload.fault || null,
      status: wo?.status || 'Open',
    });
    if (wo && payload.mechanic_id) {
      try {
        const [custRes, vehRes] = await Promise.all([
          payload.customer_id ? sb.from('customers').select('first_name,last_name').eq('id', payload.customer_id).single() : { data: null },
          payload.vehicle_id  ? sb.from('vehicles').select('year,make,model').eq('id', payload.vehicle_id).single()        : { data: null },
        ]);
        const custName = custRes.data ? custRes.data.first_name + ' ' + custRes.data.last_name : 'a customer';
        const vehLabel = vehRes.data  ? ((vehRes.data.year||'') + ' ' + vehRes.data.make + ' ' + vehRes.data.model).trim() : 'a vehicle';
        await createNotification({
          type: 'wo_update',
          title: 'New Work Order Assigned -- ' + (wo.ref || ''),
          body: 'You have been assigned a new job. Customer: ' + custName + '. Vehicle: ' + vehLabel + '. Fault: ' + (payload.fault || 'See work order') + '.',
          related_id: wo.id, related_type: 'work_order',
          for_user_id: payload.mechanic_id,
        });
      } catch(e) { console.warn('WO assignment notification failed:', e.message); }
    }
    return wo;
  }

  async function updateWorkOrder(id, payload) {
    const sid = await _shopId();
    const now  = new Date().toISOString();
    const update = { ...payload, updated_at: now };
    if (payload.status) update.status_changed_at = now;

    const { data, error } = await sb.from('work_orders')
      .update(update).eq('id', id).eq('shop_id', sid).select();
    if (error) throw error;
    const wo = data?.[0];
    await _audit('work_orders', id, payload.status ? 'STATUS_UPDATE' : 'UPDATE', {
      ref: wo?.ref || null,
      ...payload,
    });

    if (payload.status) {
      try {
        const { data: { session } } = await sb.auth.getSession();
        await sb.from('wo_status_history').insert({
          work_order_id: id, status: payload.status,
          changed_by: session?.user?.id || null, changed_at: now,
        });
      } catch(e) { console.warn('Status history write failed:', e); }

      try {
        const statusLabels = {
          'In Progress':    'Work has started on your vehicle',
          'Awaiting Parts': 'We are waiting on parts for your vehicle',
          'Completed':      'Your vehicle repair has been completed',
          'Cancelled':      'Your work order has been cancelled',
        };
        const body = statusLabels[payload.status];
        if (body) {
          await createNotification({
            type: 'wo_update',
            title: `Work Order ${wo?.ref || id} — ${payload.status}`,
            body, related_id: id, related_type: 'work_order',
          });
        }
      } catch(e) { console.warn('Status notification failed:', e); }
    }
    return wo;
  }

  async function getWOStatusHistory(workOrderId) {
    const { data, error } = await sb.from('wo_status_history')
      .select('id, status, changed_at, changed_by')
      .eq('work_order_id', workOrderId)
      .order('changed_at', { ascending: true });
    if (error) return [];
    const rows = data || [];
    const userIds = [...new Set(rows.filter(r => r.changed_by).map(r => r.changed_by))];
    let nameMap = {};
    if (userIds.length) {
      const { data: profiles } = await sb.from('profiles').select('id,full_name').in('id', userIds);
      (profiles||[]).forEach(p => { nameMap[p.id] = p.full_name; });
    }
    return rows.map(r => ({ ...r, changer_name: nameMap[r.changed_by] || 'Unknown' }));
  }

  async function addPartToWorkOrder(workOrderId, partId, qty, unitCost) {
    const beforePart = await getInventoryItem(partId).catch(() => null);
    const { data, error } = await sb.from('work_order_parts')
      .insert({ work_order_id: workOrderId, part_id: partId, qty, unit_cost: unitCost })
      .select().single();
    if (error) throw error;

    try {
      const [partRes, woRes] = await Promise.all([
        sb.from('inventory').select('name,sku').eq('id', partId).single(),
        sb.from('work_orders').select('ref').eq('id', workOrderId).single(),
      ]);
      await _audit('work_order_parts', data?.id, 'ATTACH_PART', {
        work_order_id: workOrderId,
        work_order_ref: woRes.data?.ref || null,
        part_id: partId,
        part_name: partRes.data?.name || null,
        sku: partRes.data?.sku || null,
        qty,
        unit_cost: unitCost,
      });
    } catch (e) {}

    const afterPart = await getInventoryItem(partId).catch(() => null);
    await _maybeCreateLowStockNotification(beforePart, afterPart);

    return data;
  }

  async function removePartFromWorkOrder(workOrderId, partId) {
    let removed = null;
    try {
      const [rowRes, partRes, woRes] = await Promise.all([
        sb.from('work_order_parts').select('id,qty,unit_cost').eq('work_order_id', workOrderId).eq('part_id', partId).limit(1),
        sb.from('inventory').select('name,sku').eq('id', partId).single(),
        sb.from('work_orders').select('ref').eq('id', workOrderId).single(),
      ]);
      removed = {
        row_id: rowRes.data?.[0]?.id || null,
        qty: rowRes.data?.[0]?.qty || null,
        unit_cost: rowRes.data?.[0]?.unit_cost || null,
        part_name: partRes.data?.name || null,
        sku: partRes.data?.sku || null,
        work_order_ref: woRes.data?.ref || null,
      };
    } catch (e) {}

    const { error } = await sb.from('work_order_parts')
      .delete().eq('work_order_id', workOrderId).eq('part_id', partId);
    if (error) throw error;

    await _audit('work_order_parts', removed?.row_id || workOrderId, 'REMOVE_PART', {
      work_order_id: workOrderId,
      work_order_ref: removed?.work_order_ref || null,
      part_id: partId,
      part_name: removed?.part_name || null,
      sku: removed?.sku || null,
      qty: removed?.qty || null,
      unit_cost: removed?.unit_cost || null,
    });
  }

  // Returns ALL work_order_parts for this shop — used by reports/turnover
  async function getAllWorkOrderParts() {
    const sid = await _shopId();
    const { data: woRows, error: woErr } = await sb.from('work_orders')
      .select('id, created_at').eq('shop_id', sid);
    if (woErr) throw woErr;
    if (!woRows?.length) return [];
    const woIds = woRows.map(w => w.id);
    const woDateMap = Object.fromEntries(woRows.map(w => [w.id, w.created_at]));
    const { data, error } = await sb.from('work_order_parts')
      .select('work_order_id, part_id, qty, unit_cost')
      .in('work_order_id', woIds);
    if (error) throw error;
    // Attach the WO date so reports can filter by date range
    return (data || []).map(p => ({ ...p, wo_date: woDateMap[p.work_order_id] || null }));
  }

  /* ---------------------------------------------------------------
     INVENTORY
     --------------------------------------------------------------- */
  async function getInventory(filters = {}) {
    const sid = await _shopId();
    let q = sb.from('inventory').select('*, suppliers(id,name)').eq('shop_id', sid).order('name');
    if (filters.category) q = q.eq('category', filters.category);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map(item => ({
      ...item,
      supplier_name: item.suppliers?.name || null,
      stock_status: item.qty <= 0
        ? 'Out of Stock'
        : item.qty <= (item.threshold || 0) ? 'Low Stock' : 'In Stock',
    }));
  }

  async function getInventoryItem(id) {
    const sid = await _shopId();
    const { data, error } = await sb.from('inventory')
      .select('*').eq('id', id).eq('shop_id', sid).single();
    if (error) throw error;
    return data;
  }

  async function createInventoryItem(payload) {
    const sid = await _shopId();
    const { data, error } = await sb.from('inventory')
      .insert({ ...payload, shop_id: sid }).select().single();
    if (error) throw error;
    await _audit('inventory', data?.id, 'CREATE', {
      name: data?.name || payload.name || null,
      sku: data?.sku || payload.sku || null,
      qty: data?.qty ?? payload.qty ?? null,
      category: data?.category || payload.category || null,
    });
    return data;
  }

  async function updateInventoryItem(id, payload) {
    const sid = await _shopId();
    const before = await getInventoryItem(id).catch(() => null);
    const { data, error } = await sb.from('inventory')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id).eq('shop_id', sid).select().single();
    if (error) throw error;
    await _audit('inventory', id, 'UPDATE', {
      name: data?.name || null,
      sku: data?.sku || null,
      ...payload,
    });
    await _maybeCreateLowStockNotification(before, data);
    return data;
  }

  async function adjustStock(id, delta, reason = '') {
    const before = await getInventoryItem(id);
    const { data, error } = await sb.rpc('adjust_inventory_qty', {
      p_part_id: id, p_delta: delta, p_reason: reason,
    });
    if (error) throw error;
    const after = await getInventoryItem(id);
    await _audit('inventory', id, 'ADJUST_STOCK', {
      name: after?.name || before?.name || null,
      sku: after?.sku || before?.sku || null,
      delta,
      reason: reason || null,
      previous_qty: before?.qty ?? null,
      new_qty: after?.qty ?? null,
    });
    await _maybeCreateLowStockNotification(before, after);
    return data;
  }

  async function getLowStockItems() {
    const sid = await _shopId();
    const { data, error } = await sb.from('inventory')
      .select('*').eq('shop_id', sid).order('qty');
    if (error) throw error;
    return (data || []).filter(item => item.qty <= (item.threshold || 0));
  }

  /* ---------------------------------------------------------------
     SUPPLIERS
     --------------------------------------------------------------- */
  async function getSuppliers() {
    const sid = await _shopId();
    const { data, error } = await sb.from('suppliers')
      .select('*').eq('shop_id', sid).order('name');
    if (error) throw error;
    return data;
  }

  async function createSupplier(payload) {
    const sid = await _shopId();
    const { data, error } = await sb.from('suppliers')
      .insert({ ...payload, shop_id: sid }).select().single();
    if (error) throw error;
    await _audit('suppliers', data?.id, 'CREATE', {
      name: data?.name || payload.name || null,
      contact: data?.contact || payload.contact || null,
      phone: data?.phone || payload.phone || null,
    });
    return data;
  }

  async function updateSupplier(id, payload) {
    const sid = await _shopId();
    const { data, error } = await sb.from('suppliers')
      .update(payload).eq('id', id).eq('shop_id', sid).select().single();
    if (error) throw error;
    await _audit('suppliers', id, 'UPDATE', {
      name: data?.name || null,
      ...payload,
    });
    return data;
  }

  /* ---------------------------------------------------------------
     PURCHASE ORDERS
     --------------------------------------------------------------- */
  async function getPurchaseOrders() {
    const sid = await _shopId();
    const { data, error } = await sb.from('purchase_orders')
      .select('*, suppliers(id,name,phone,email), purchase_order_items(*, inventory:part_id(id,name,sku))') 
      .eq('shop_id', sid).order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async function createPurchaseOrder(supplierId, items, notes = '', expectedAt = null) {
    const sid = await _shopId();
    const poPayload = { supplier_id: supplierId, notes: notes || null, ref: '', shop_id: sid };
    if (expectedAt) poPayload.expected_at = expectedAt;

    const { data: po, error: poErr } = await sb.from('purchase_orders')
      .insert(poPayload).select().single();
    if (poErr) throw poErr;

    const poItems = items.map(i => ({
      po_id:     po.id,
      part_id:   i.part_id || i.inventory_id || i.partId,
      qty:       i.qty || i.qty_ordered || 1,
      unit_cost: i.unit_cost ?? i.cost ?? i.unitCost ?? 0,
    }));
    const { error: itemErr } = await sb.from('purchase_order_items').insert(poItems);
    if (itemErr) throw itemErr;

    const { data: full } = await sb.from('purchase_orders')
      .select('*, suppliers(id,name,phone,email), purchase_order_items(*, inventory:part_id(name,sku))') 
      .eq('id', po.id).single();
    await _audit('purchase_orders', po?.id, 'CREATE', {
      ref: full?.ref || po?.ref || null,
      supplier_id: supplierId,
      supplier_name: full?.suppliers?.name || null,
      item_count: items.length,
      notes: notes || null,
      expected_at: expectedAt || null,
    });
    return full || po;
  }

  async function updatePOStatus(id, status) {
    const sid = await _shopId();
    const updates = { status, updated_at: new Date().toISOString() };
    if (status === 'Sent') updates.sent_at = new Date().toISOString();
    const { data, error } = await sb.from('purchase_orders')
      .update(updates).eq('id', id).eq('shop_id', sid).select().single();
    if (error) throw error;
    await _audit('purchase_orders', id, 'STATUS_UPDATE', {
      ref: data?.ref || null,
      status,
    });
    if (status === 'Received' || status === 'Partially Received') {
      await createNotification({
        type: 'po_update',
        title: `Purchase Order ${data?.ref || id} — ${status}`,
        body: `${data?.ref || 'A purchase order'} was marked ${status.toLowerCase()}.`,
        related_id: id,
        related_type: 'purchase_order',
      });
    }
    return data;
  }

  async function receivePOItem(poItemId, qtyReceived) {
    const { data: current, error: fetchErr } = await sb.from('purchase_order_items')
      .select('qty_received, qty, po_id, part_id').eq('id', poItemId).single();
    if (fetchErr) throw fetchErr;
    const newTotal = Math.min((current?.qty_received || 0) + qtyReceived, current?.qty || 0);
    const { data, error } = await sb.from('purchase_order_items')
      .update({ qty_received: newTotal }).eq('id', poItemId).select().single();
    if (error) throw error;
    try {
      const [partRes, poRes] = await Promise.all([
        current?.part_id ? sb.from('inventory').select('name,sku').eq('id', current.part_id).single() : { data: null },
        current?.po_id ? sb.from('purchase_orders').select('ref').eq('id', current.po_id).single() : { data: null },
      ]);
      await _audit('purchase_order_items', poItemId, 'RECEIVE_STOCK', {
        po_id: current?.po_id || null,
        po_ref: poRes.data?.ref || null,
        part_id: current?.part_id || null,
        part_name: partRes.data?.name || null,
        sku: partRes.data?.sku || null,
        qty_received_now: qtyReceived,
        qty_received_total: newTotal,
      });
    } catch (e) {}
    return data;
  }

  /* ---------------------------------------------------------------
     INVOICES
     --------------------------------------------------------------- */
  async function getInvoices(filters = {}) {
    const sid = await _shopId();

    // Step 1: get IDs scoped to this shop from the base table
    let baseQ = sb.from('invoices')
      .select('id').eq('shop_id', sid);
    if (filters.status)      baseQ = baseQ.eq('status', filters.status);
    if (filters.customer_id) baseQ = baseQ.eq('customer_id', filters.customer_id);
    const { data: baseRows, error: baseErr } = await baseQ;
    if (baseErr) throw baseErr;
    if (!baseRows?.length) return [];

    // Step 2: query the view (which has customer_name, customer_email, wo_ref, total)
    // filtered to only IDs belonging to this shop
    const ids = baseRows.map(r => r.id);
    const { data, error } = await sb.from('v_invoices')
      .select('*')
      .in('id', ids)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(inv => ({
      ...inv,
      total_amount: inv.total_amount ?? inv.total ?? 0,
      shop_id: sid,
    }));
  }

  async function createInvoice(payload) {
    const sid = await _shopId();
    const { data, error } = await sb.from('invoices')
      .insert({ ...payload, shop_id: sid, ref: '' }).select().single();
    if (error) throw error;
    await _audit('invoices', data?.id, 'CREATE', {
      ref: data?.ref || null,
      customer_id: payload.customer_id || null,
      work_order_id: payload.work_order_id || null,
      total_amount: payload.total_amount || null,
      status: data?.status || payload.status || null,
    });
    return data;
  }

  async function generateInvoiceFromWO(workOrderId) {
    const sid = await _shopId();
    const [woRes, settingsRes] = await Promise.all([
      sb.from('work_orders').select('*, customers(id,first_name,last_name), work_order_parts(id,qty,unit_cost,part_id,inventory:part_id(name))').eq('id', workOrderId).single(),
      sb.from('shop_settings').select('labor_rate,tax_rate').eq('shop_id', sid).single(),
    ]);
    if (woRes.error) throw new Error('Work order not found');
    const wo = woRes.data;
    const settings = settingsRes.data || {};
    const laborRate   = parseFloat(settings.labor_rate || 0);
    const taxRate     = parseFloat(settings.tax_rate   || 0) / 100;
    const laborAmount = Math.round((wo.labor_hours || 0) * laborRate * 100) / 100;
    const partsAmount = Math.round((wo.work_order_parts || []).reduce((s, p) => s + (p.unit_cost || 0) * (p.qty || 0), 0) * 100) / 100;
    const taxAmount   = Math.round((laborAmount + partsAmount) * taxRate * 100) / 100;
    const total       = laborAmount + partsAmount + taxAmount;
    const { data: inv, error: invErr } = await sb.from('invoices').insert({
      shop_id: sid, work_order_id: workOrderId, customer_id: wo.customer_id,
      ref: '', status: 'Unpaid', invoice_date: new Date().toISOString().split('T')[0],
      labor_amount: laborAmount, parts_amount: partsAmount, tax_amount: taxAmount, total_amount: total,
    }).select().single();
    if (invErr) throw invErr;
    await _audit('invoices', inv?.id, 'GENERATE_FROM_WO', {
      ref: inv?.ref || null,
      work_order_id: workOrderId,
      total_amount: total,
      labor_amount: laborAmount,
      parts_amount: partsAmount,
      tax_amount: taxAmount,
    });
    return inv;
  }

  async function getInvoiceFull(invoiceId) {
    const sid = await _shopId();
    const { data: viewData } = await sb.from('v_invoices').select('*').eq('id', invoiceId).single();
    if (viewData) return { ...viewData, total_amount: viewData.total_amount ?? viewData.total ?? 0 };
    const { data: inv, error } = await sb.from('invoices')
      .select('*, customers(id,first_name,last_name), work_orders(ref,fault,labor_hours)')
      .eq('id', invoiceId).eq('shop_id', sid).single();
    if (error) throw error;
    let parts = [];
    if (inv.work_order_id) {
      const { data: woParts } = await sb.from('work_order_parts')
        .select('qty, unit_cost, inventory:part_id(name,sku)').eq('work_order_id', inv.work_order_id);
      parts = (woParts || []).map(p => ({ name: p.inventory?.name || '—', sku: p.inventory?.sku || '', qty: p.qty, unit_cost: p.unit_cost }));
    }
    const { data: shop } = await sb.from('shops').select('name,phone,email,address').eq('id', sid).single();
    return { ...inv, total_amount: inv.total_amount ?? inv.total ?? 0,
      customer_name: inv.customers ? inv.customers.first_name + ' ' + inv.customers.last_name : '—',
      wo_ref: inv.work_orders?.ref || '—', parts, shop: shop || {} };
  }

  async function markInvoicePaid(id, method = 'Card') {
    const sid = await _shopId();
    const { data, error } = await sb.from('invoices')
      .update({
        status: 'Paid', payment_method: method,
        paid_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      })
      .eq('id', id).eq('shop_id', sid).select().single();
    if (error) throw error;
    await _audit('invoices', id, 'MARK_PAID', {
      ref: data?.ref || null,
      payment_method: method,
      total_amount: data?.total_amount ?? null,
    });
    await createNotification({
      type: 'payment',
      title: `Invoice Payment Received — ${data?.ref || id}`,
      body: `${data?.ref || 'An invoice'} was marked paid via ${method}.`,
      related_id: id,
      related_type: 'invoice',
    });
    return data;
  }

  async function updateInvoiceStatus(id, status) {
    const sid = await _shopId();
    const { data, error } = await sb.from('invoices')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id).eq('shop_id', sid).select().single();
    if (error) throw error;
    await _audit('invoices', id, 'STATUS_UPDATE', {
      ref: data?.ref || null,
      status,
    });
    return data;
  }

  /* ---------------------------------------------------------------
     APPOINTMENTS
     --------------------------------------------------------------- */
  async function getAppointments(filters = {}) {
    const sid = await _shopId();

    // Step 1: get base data including guest columns from the base table
    let baseQ = sb.from('appointments')
      .select('id, guest_name, guest_phone, guest_email, vehicle_info, customer_id')
      .eq('shop_id', sid);
    if (filters.upcoming)    baseQ = baseQ.gte('appt_date', new Date().toISOString().split('T')[0]);
    if (filters.mechanic_id) baseQ = baseQ.eq('mechanic_id', filters.mechanic_id);
    const { data: baseRows, error: baseErr } = await baseQ;
    if (baseErr) throw baseErr;
    if (!baseRows?.length) return [];

    // Build a map of id → guest fields for merging
    const guestMap = {};
    baseRows.forEach(r => {
      guestMap[r.id] = {
        guest_name:   r.guest_name,
        guest_phone:  r.guest_phone,
        guest_email:  r.guest_email,
        vehicle_info: r.vehicle_info,
      };
    });

    // Step 2: query the view for enriched data (customer_name, vehicle_label, mechanic_name)
    const ids = baseRows.map(r => r.id);
    const { data, error } = await sb.from('v_appointments')
      .select('*')
      .in('id', ids)
      .order('appt_date').order('appt_time');
    if (error) throw error;

    // Step 3: merge guest fields back in — these aren't in the view
    return (data || []).map(a => {
      const g = guestMap[a.id] || {};
      return {
        ...a,
        guest_name:   g.guest_name   != null ? g.guest_name   : (a.guest_name   || null),
        guest_phone:  g.guest_phone  != null ? g.guest_phone  : (a.guest_phone  || null),
        guest_email:  g.guest_email  != null ? g.guest_email  : (a.guest_email  || null),
        vehicle_info: g.vehicle_info != null ? g.vehicle_info : (a.vehicle_info || null),
        vehicle_label: a.vehicle_label || g.vehicle_info || null,
      };
    });
  }

  async function createAppointment(payload) {
    const sid = await _shopId();
    const { data, error } = await sb.from('appointments')
      .insert({ ...payload, shop_id: sid, ref: '' }).select().single();
    if (error) throw error;
    await _audit('appointments', data?.id, 'CREATE', {
      customer_id: payload.customer_id || null,
      mechanic_id: payload.mechanic_id || null,
      appt_date: payload.appt_date || null,
      appt_time: payload.appt_time || null,
      service: payload.service || null,
      guest_name: payload.guest_name || null,
    });
    if ((data?.status || payload.status) === 'Pending') {
      let customerLabel = payload.guest_name || 'A customer';
      if (!payload.guest_name && payload.customer_id) {
        try {
          const { data: customer } = await sb.from('customers')
            .select('first_name,last_name')
            .eq('id', payload.customer_id)
            .single();
          if (customer) customerLabel = `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || customerLabel;
        } catch {}
      }

      const apptDate = data?.appt_date
        ? new Date(`${data.appt_date}T12:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
        : 'the selected date';
      const apptTime = data?.appt_time ? String(data.appt_time).slice(0, 5) : '';

      await createNotification({
        type: 'appointment',
        title: 'New Booking Request',
        body: `${customerLabel} requested ${data?.service || payload.service || 'service'} for ${apptDate}${apptTime ? ` at ${apptTime}` : ''}.`,
        related_id: data?.id || null,
        related_type: 'appointment',
      });
    }
    return data;
  }

  async function updateAppointment(id, payload) {
    const sid = await _shopId();
    const { data, error } = await sb.from('appointments')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id).eq('shop_id', sid).select().single();
    if (error) throw error;
    await _audit('appointments', id, payload.status ? 'STATUS_UPDATE' : 'UPDATE', payload);
    return data;
  }

  async function cancelAppointment(id) {
    return updateAppointment(id, { status: 'Cancelled' });
  }

  /* ---------------------------------------------------------------
     NOTIFICATIONS
     --------------------------------------------------------------- */
  async function createNotification(payload) {
    try {
      const sid = await _shopId();
      const { error } = await sb.from('notifications').insert({
        type:         payload.type         || 'wo_update',
        title:        payload.title,
        body:         payload.body,
        related_id:   payload.related_id   || null,
        related_type: payload.related_type || null,
        for_user_id:  payload.for_user_id  || null,
        shop_id:      sid,
        read:         false,
      });
      if (error) console.warn('Notification insert error:', error);
    } catch(e) { console.warn('createNotification failed:', e); }
  }

  async function getNotifications(unreadOnly = false) {
    const sid = await _shopId();
    const { data: { user: authUser } } = await sb.auth.getUser();
    const uid = authUser?.id || null;
    let q = sb.from('notifications')
      .select('*').eq('shop_id', sid)
      .or('for_user_id.is.null,for_user_id.eq.' + uid)
      .order('created_at', { ascending: false });
    if (unreadOnly) q = q.eq('read', false);
    const { data, error } = await q;
    if (error) throw error;
    return filterNotificationsByPreference(data);
  }

  async function getUnreadCount() {
    const sid = await _shopId();
    const { data: { user: authUser } } = await sb.auth.getUser();
    const uid = authUser?.id || null;
    const { data, error } = await sb.from('notifications')
      .select('id, type')
      .eq('shop_id', sid).eq('read', false)
      .or('for_user_id.is.null,for_user_id.eq.' + uid);
    if (error) return 0;
    const visible = await filterNotificationsByPreference(data);
    return visible.length;
  }

  async function markNotificationRead(id) {
    const sid = await _shopId();
    const { error } = await sb.from('notifications')
      .update({ read: true, read_at: new Date().toISOString() })
      .eq('id', id).eq('shop_id', sid);
    if (error) throw error;
  }

  async function markAllNotificationsRead() {
    const sid = await _shopId();
    const { error } = await sb.from('notifications')
      .update({ read: true, read_at: new Date().toISOString() })
      .eq('shop_id', sid).eq('read', false);
    if (error) throw error;
  }

  async function deleteNotification(id) {
    const sid = await _shopId();
    const { error } = await sb.from('notifications')
      .delete().eq('id', id).eq('shop_id', sid);
    if (error) throw error;
  }

  async function clearReadNotifications() {
    const sid = await _shopId();
    const { error } = await sb.from('notifications')
      .delete().eq('shop_id', sid).eq('read', true);
    if (error) throw error;
  }

  /* ---------------------------------------------------------------
     DASHBOARD KPIs  — computed directly, always shop-scoped
     --------------------------------------------------------------- */
  async function getDashboardKPIs() {
    const sid   = await _shopId();
    const now   = new Date().toISOString().split('T')[0];
    const month = now.slice(0, 7);

    const [wosRes, invItemsRes, apptRes, invRes, notifRes] = await Promise.allSettled([
      sb.from('work_orders')
        .select('id', { count: 'exact', head: true })
        .eq('shop_id', sid)
        .in('status', ['Open', 'In Progress', 'Awaiting Parts']),
      sb.from('inventory')
        .select('id, qty, threshold')
        .eq('shop_id', sid),
      sb.from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('shop_id', sid)
        .gte('appt_date', now),
      // Use base table — total = labor_amount + parts_amount + tax_amount
      sb.from('invoices')
        .select('labor_amount, parts_amount, tax_amount, paid_at, status')
        .eq('shop_id', sid),
      sb.from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('shop_id', sid)
        .eq('read', false),
    ]);

    const activeWOs     = wosRes.status     === 'fulfilled' ? (wosRes.value.count     || 0) : 0;
    const invItems      = invItemsRes.status === 'fulfilled' ? (invItemsRes.value.data || []) : [];
    const lowStock      = invItems.filter(p => (p.qty || 0) <= (p.threshold || 0)).length;
    const upcomingAppts = apptRes.status     === 'fulfilled' ? (apptRes.value.count    || 0) : 0;
    const unreadNotifs  = notifRes.status    === 'fulfilled' ? (notifRes.value.count   || 0) : 0;

    let revenueThisMonth = 0;
    let unpaidInvoices   = 0;
    if (invRes.status === 'fulfilled') {
      const invoices = invRes.value.data || [];
      revenueThisMonth = invoices
        .filter(i => i.status === 'Paid' && i.paid_at?.startsWith(month))
        .reduce((s, i) => s + (Number(i.labor_amount) || 0) + (Number(i.parts_amount) || 0) + (Number(i.tax_amount) || 0), 0);
      unpaidInvoices = invoices.filter(i => ['Unpaid', 'Overdue'].includes(i.status)).length;
    }

    return {
      active_work_orders:    activeWOs,
      low_stock_parts:       lowStock,
      upcoming_appointments: upcomingAppts,
      revenue_this_month:    revenueThisMonth,
      unpaid_invoices:       unpaidInvoices,
      unread_notifications:  unreadNotifs,
    };
  }

  /* ---------------------------------------------------------------
     REVENUE CHARTS
     --------------------------------------------------------------- */
  async function getRevenueMonthly(months = 7) {
    const sid = await _shopId();
    const { data, error } = await sb.from('revenue_snapshots')
      .select('*').eq('shop_id', sid)
      .eq('period_type', 'month')
      .order('period', { ascending: true }).limit(months);
    if (error) throw error;
    return (data || []).map(r => ({
      label: r.period.slice(-2).replace(/^0/, ''),
      value: r.amount,
      formatted: formatCurrency(r.amount),
    }));
  }

  async function getRevenueWeekly() {
    const sid = await _shopId();
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      days.push(d.toISOString().split('T')[0]);
    }
    const since = days[0] + 'T00:00:00.000Z';

    const { data, error } = await sb.from('invoices')
      .select('paid_at, labor_amount, parts_amount, tax_amount')
      .eq('shop_id', sid).eq('status', 'Paid')
      .gte('paid_at', since).not('paid_at', 'is', null);
    if (error) throw error;

    const byDay = {};
    days.forEach(d => { byDay[d] = 0; });
    (data || []).forEach(inv => {
      const day = inv.paid_at.split('T')[0];
      if (byDay[day] !== undefined) {
        byDay[day] += (Number(inv.labor_amount) || 0)
                    + (Number(inv.parts_amount) || 0)
                    + (Number(inv.tax_amount)   || 0);
      }
    });

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days.map(d => ({
      label: dayNames[new Date(d + 'T12:00:00').getDay()],
      value: byDay[d], date: d,
    }));
  }

  /* ---------------------------------------------------------------
     STAFF  — only staff belonging to this shop
     --------------------------------------------------------------- */
  async function getStaff() {
    const sid = await _shopId();
    const { data, error } = await sb.from('profiles')
      .select('*').eq('shop_id', sid).order('full_name');
    if (error) throw error;
    return data;
  }

  async function updateProfile(id, payload) {
    const { data, error } = await sb.from('profiles')
      .update(payload).eq('id', id).select().single();
    if (error) throw error;
    await _audit('profiles', id, 'UPDATE', payload);
    return data;
  }

  /* ---------------------------------------------------------------
     SHOP SETTINGS
     --------------------------------------------------------------- */
  async function getSettings() {
    const sid = await _shopId();
    const { data, error } = await sb.from('shop_settings')
      .select('*').eq('shop_id', sid).single();
    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
  }

  async function updateSettings(payload) {
    const sid = await _shopId();
    const existing = await getSettings();
    if (existing) {
      const { data, error } = await sb.from('shop_settings')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', existing.id).select().single();
      if (error) throw error;
      return data;
    } else {
      const { data, error } = await sb.from('shop_settings')
        .insert({ ...payload, shop_id: sid }).select().single();
      if (error) throw error;
      return data;
    }
  }

  /* ---------------------------------------------------------------
     PUBLIC API
     --------------------------------------------------------------- */
  return {
    getCustomers, getCustomer, createCustomer, updateCustomer, deleteCustomer, getAuditLog,
    getVehicles, createVehicle, updateVehicle, deleteVehicle,
    getWorkOrders, getWorkOrder, createWorkOrder, updateWorkOrder, getWOStatusHistory,
    addPartToWorkOrder, removePartFromWorkOrder, getAllWorkOrderParts,
    getInventory, getInventoryItem, createInventoryItem, updateInventoryItem,
    adjustStock, getLowStockItems,
    getSuppliers, createSupplier, updateSupplier,
    getPurchaseOrders, createPurchaseOrder, updatePOStatus, receivePOItem,
    getInvoices, createInvoice, generateInvoiceFromWO, getInvoiceFull, markInvoicePaid, updateInvoiceStatus,
    getAppointments, createAppointment, updateAppointment, cancelAppointment,
    createNotification, getNotifications, getUnreadCount, markNotificationRead,
    markAllNotificationsRead, deleteNotification, clearReadNotifications,
    getNotificationPreferences, saveNotificationPreferences, isNotificationEnabled,
    getDashboardKPIs,
    getRevenueMonthly, getRevenueWeekly,
    getStaff, updateProfile,
    getShopActivity, logPageView, logActivity,
    getSettings, updateSettings,
  };
})();

/* =================================================================
   LIVE NOTIFICATION BADGE
   ================================================================= */
async function initLiveNotificationBadge() {
  const count = await GS.getUnreadCount();
  updateNotifBadges(count);

  Realtime.subscribe('notifications', {
    onInsert: async (newNotif) => {
      const count = await GS.getUnreadCount();
      updateNotifBadges(count);
      if (await GS.isNotificationEnabled(newNotif.type)) {
        Toast.show(newNotif.title, 'info', 5000);
      }
    },
    onUpdate: async () => {
      const count = await GS.getUnreadCount();
      updateNotifBadges(count);
    },
  });
}

function updateNotifBadges(count) {
  document.querySelectorAll('.nav-badge, #sidebarBadge').forEach(el => {
    el.textContent = count;
    el.style.display = count > 0 ? '' : 'none';
  });
}
