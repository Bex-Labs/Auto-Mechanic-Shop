/* =================================================================
   GEARSHIFT — MAIN.JS
   Shared utilities: nav, toast, modal, filters, helpers
   ================================================================= */

/* -----------------------------------------------------------------
   NAV SCROLL EFFECT
   ----------------------------------------------------------------- */
(function () {
  const nav = document.querySelector('.site-nav');
  if (!nav) return;
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 20);
  });
})();

/* -----------------------------------------------------------------
   ACTIVE NAV LINK — highlight current page
   ----------------------------------------------------------------- */
(function () {
  const path = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-link[data-page]').forEach(link => {
    if (link.dataset.page === path) link.classList.add('active');
  });
})();

/* -----------------------------------------------------------------
   TOAST SYSTEM
   ----------------------------------------------------------------- */
const Toast = (() => {
  let container = null;

  function getContainer() {
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    return container;
  }

  function show(message, type = 'success', duration = 3500) {
    const icons = {
      success: '✓',
      error:   '✕',
      warn:    '⚠',
      info:    'ℹ'
    };
    const c = getContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span class="toast-icon">${icons[type] || '•'}</span><span>${message}</span>`;
    c.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('leaving');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  return { show };
})();

/* -----------------------------------------------------------------
   MODAL SYSTEM
   ----------------------------------------------------------------- */
const Modal = (() => {
  function open(id) {
    const el = document.getElementById(id);
    if (el) {
      el.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
  }

  function close(id) {
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove('open');
      document.body.style.overflow = '';
    }
  }

  function closeAll() {
    document.querySelectorAll('.modal-backdrop.open').forEach(m => {
      m.classList.remove('open');
    });
    document.body.style.overflow = '';
  }

  // Click outside to close
  document.addEventListener('click', e => {
    if (e.target.classList.contains('modal-backdrop')) {
      closeAll();
    }
  });

  // ESC to close
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeAll();
  });

  return { open, close, closeAll };
})();

/* -----------------------------------------------------------------
   SUB-NAV / VIEW PANE SWITCHER
   ----------------------------------------------------------------- */
function initSubNav(subNavSelector, paneSelector) {
  const links = document.querySelectorAll(subNavSelector);
  const panes = document.querySelectorAll(paneSelector);

  links.forEach(link => {
    link.addEventListener('click', () => {
      const target = link.dataset.pane;

      links.forEach(l => l.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      link.classList.add('active');
      const pane = document.getElementById(target);
      if (pane) pane.classList.add('active');
    });
  });

  // Activate first by default
  if (links.length) links[0].click();
}

/* -----------------------------------------------------------------
   TABLE SEARCH FILTER
   ----------------------------------------------------------------- */
function filterTable(inputId, tableBodyId, columnIndexes) {
  const input = document.getElementById(inputId);
  const tbody = document.getElementById(tableBodyId);
  if (!input || !tbody) return;

  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim();
    tbody.querySelectorAll('tr').forEach(row => {
      const cells = row.querySelectorAll('td');
      const match = columnIndexes.some(i => cells[i] && cells[i].textContent.toLowerCase().includes(q));
      row.style.display = (match || !q) ? '' : 'none';
    });
  });
}

/* -----------------------------------------------------------------
   TABLE STATUS FILTER (select dropdown)
   ----------------------------------------------------------------- */
function filterTableBySelect(selectId, tableBodyId, columnIndex) {
  const select = document.getElementById(selectId);
  const tbody = document.getElementById(tableBodyId);
  if (!select || !tbody) return;

  select.addEventListener('change', () => {
    const val = select.value.toLowerCase().trim();
    tbody.querySelectorAll('tr').forEach(row => {
      const cells = row.querySelectorAll('td');
      const match = !val || (cells[columnIndex] && cells[columnIndex].textContent.toLowerCase().includes(val));
      row.style.display = match ? '' : 'none';
    });
  });
}

/* -----------------------------------------------------------------
   BAR CHART RENDERER
   ----------------------------------------------------------------- */
function renderBarChart(containerId, data, color = '#c94b1e') {
  const container = document.getElementById(containerId);
  if (!container) return;

  const max = Math.max(...data.map(d => d.value));
  container.innerHTML = '';

  data.forEach(d => {
    const pct = max > 0 ? (d.value / max) * 100 : 0;
    const col = document.createElement('div');
    col.className = 'bar-col';
    col.innerHTML = `
      <div class="bar" style="height:${pct}%;background:${color}">
        <div class="bar-tooltip">${d.label}: ${d.formatted || d.value}</div>
      </div>
      <div class="bar-label">${d.label}</div>
    `;
    container.appendChild(col);
  });
}

/* -----------------------------------------------------------------
   STOCK BAR RENDERER
   ----------------------------------------------------------------- */
function renderStockBar(containerEl, qty, threshold, max) {
  const pct = Math.min(100, Math.round((qty / (max || threshold * 2)) * 100));
  const cls = qty <= threshold ? 'low' : pct < 60 ? 'medium' : 'high';
  containerEl.innerHTML = `<div class="stock-bar"><div class="stock-fill ${cls}" style="width:${pct}%"></div></div>`;
}

/* -----------------------------------------------------------------
   BADGE HELPERS
   ----------------------------------------------------------------- */
const BadgeMap = {
  // Work order
  'Open':            'badge-open',
  'In Progress':     'badge-inprogress',
  'Awaiting Parts':  'badge-awaiting',
  'Completed':       'badge-completed',
  'Cancelled':       'badge-cancelled',
  // Invoice
  'Paid':            'badge-paid',
  'Unpaid':          'badge-unpaid',
  'Partial':         'badge-partial',
  'Overdue':         'badge-overdue',
  // Inventory
  'In Stock':        'badge-instock',
  'Low Stock':       'badge-lowstock',
  'Out of Stock':    'badge-outofstock',
  // PO
  'Draft':           'badge-draft',
  'Sent':            'badge-sent',
  'Received':        'badge-received',
  'Partially Received': 'badge-partial',
  // User
  'Active':          'badge-active',
  'Inactive':        'badge-inactive',
  // Roles
  'Admin':           'badge-admin',
  'Service Advisor': 'badge-advisor',
  'Mechanic':        'badge-mechanic',
  'Parts Manager':   'badge-parts',
  // Appointment
  'Confirmed':       'badge-confirmed',
  'Pending':         'badge-pending',
  'No Show':         'badge-noshow',
};

function makeBadge(status) {
  const cls = BadgeMap[status] || 'badge-open';
  return `<span class="badge ${cls}">${status}</span>`;
}

/* -----------------------------------------------------------------
   FORMAT HELPERS
   ----------------------------------------------------------------- */
function formatCurrency(amount) {
  return '₦' + Number(amount || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr) {
  if (!dateStr || dateStr === '—') return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateShort(dateStr) {
  if (!dateStr || dateStr === '—') return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function timeAgo(dateStr) {
  const now = new Date('2026-03-01');
  const d = new Date(dateStr);
  const diff = Math.floor((now - d) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7)  return `${diff} days ago`;
  if (diff < 30) return `${Math.floor(diff/7)} weeks ago`;
  return `${Math.floor(diff/30)} months ago`;
}

function generateId(prefix, existing) {
  const nums = existing
    .map(x => parseInt(x.id?.replace(prefix + '-', '') || 0))
    .filter(n => !isNaN(n));
  const max = nums.length ? Math.max(...nums) : 1000;
  return `${prefix}-${max + 1}`;
}

/* -----------------------------------------------------------------
   CONFIRM DIALOG
   ----------------------------------------------------------------- */
function confirmAction(message, onConfirm) {
  if (window.confirm(message)) onConfirm();
}

/* -----------------------------------------------------------------
   FORM HELPERS
   ----------------------------------------------------------------- */
function getFormValues(formId) {
  const form = document.getElementById(formId);
  if (!form) return {};
  const data = {};
  form.querySelectorAll('[name]').forEach(el => {
    data[el.name] = el.value.trim();
  });
  return data;
}

function clearForm(formId) {
  const form = document.getElementById(formId);
  if (!form) return;
  form.querySelectorAll('input:not([type="hidden"]), textarea').forEach(el => {
    el.value = '';
  });
  form.querySelectorAll('select').forEach(el => {
    el.selectedIndex = 0;
  });
}

/* -----------------------------------------------------------------
   CONTACT FORM (contact.html)
   ----------------------------------------------------------------- */
function initContactForm() {
  const form = document.getElementById('contactForm');
  if (!form) return;

  form.addEventListener('submit', e => {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    btn.textContent = 'Sending...';
    btn.disabled = true;

    setTimeout(() => {
      Toast.show('Message sent! We\'ll be in touch within 1 business day.', 'success', 4000);
      form.reset();
      btn.textContent = 'Send Message →';
      btn.disabled = false;
    }, 1200);
  });
}

/* -----------------------------------------------------------------
   SMOOTH SCROLL TO SECTION (for landing page anchors)
   ----------------------------------------------------------------- */
function scrollTo(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* -----------------------------------------------------------------
   ANIMATE ON SCROLL (intersection observer)
   ----------------------------------------------------------------- */
(function () {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.animationPlayState = 'running';
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('[data-animate]').forEach(el => {
    el.style.animationPlayState = 'paused';
    observer.observe(el);
  });
})();

/* -----------------------------------------------------------------
   PANE SWITCHER (used by all app pages via onclick="switchPane(this)")
   ----------------------------------------------------------------- */
function switchPane(btn) {
  const targetId = btn.dataset.pane;
  if (!targetId) return;

  // Deactivate all sub-nav buttons in the same nav
  const nav = btn.closest('.app-sub-nav');
  if (nav) nav.querySelectorAll('.app-sub-link').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  // Hide all panes, show target
  document.querySelectorAll('.view-pane').forEach(p => p.classList.remove('active'));
  const target = document.getElementById(targetId);
  if (target) target.classList.add('active');
}


/* -----------------------------------------------------------------
   SESSION TIMEOUT
   Auto-logout after 10 minutes of inactivity.
   Shows a 2-minute warning before signing out.
   Only active on app pages (not login/public pages).
   ----------------------------------------------------------------- */
(function () {
  var TIMEOUT_MS  = 10 * 60 * 1000; // 10 minutes
  var WARNING_MS  = 2  * 60 * 1000; // warn 2 minutes before
  var _timer      = null;
  var _warnTimer  = null;
  var _warnShown  = false;
  var _warningEl  = null;
  var _countdownTimer = null;
  var _secondsLeft = 0;

  // Only run on app pages (they have .app-layout)
  function isAppPage() {
    return !!document.querySelector('.app-layout');
  }

  function createWarningBanner() {
    if (_warningEl) return;
    _warningEl = document.createElement('div');
    _warningEl.id = 'session-warning';
    _warningEl.style.cssText = [
      'position:fixed', 'bottom:24px', 'left:50%', 'transform:translateX(-50%)',
      'background:#1f2937', 'border:1px solid #e8a020', 'border-radius:8px',
      'padding:16px 24px', 'display:flex', 'align-items:center', 'gap:16px',
      'z-index:99999', 'box-shadow:0 8px 32px rgba(0,0,0,0.4)',
      'font-family:var(--ff-body,sans-serif)', 'font-size:14px',
      'color:#e6edf3', 'min-width:340px', 'max-width:480px',
      'animation:slideUp 0.3s ease'
    ].join(';');

    var style = document.createElement('style');
    style.textContent = '@keyframes slideUp{from{opacity:0;transform:translateX(-50%) translateY(20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}';
    document.head.appendChild(style);

    _warningEl.innerHTML =
      '<span style="font-size:22px">⏱</span>' +
      '<div style="flex:1">' +
        '<div style="font-weight:600;color:#e8a020;margin-bottom:3px">Session Expiring</div>' +
        '<div style="font-size:13px;color:#7d8590">You will be logged out in <span id="session-countdown" style="color:#e8a020;font-weight:700;font-family:monospace"></span></div>' +
      '</div>' +
      '<button onclick="SessionTimeout.keepAlive()" style="' +
        'background:#c94b1e;color:#fff;border:none;border-radius:6px;' +
        'padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;' +
        'white-space:nowrap;font-family:inherit' +
      '">Stay Logged In</button>';

    document.body.appendChild(_warningEl);
  }

  function removeWarningBanner() {
    if (_warningEl) {
      _warningEl.remove();
      _warningEl = null;
    }
    if (_countdownTimer) {
      clearInterval(_countdownTimer);
      _countdownTimer = null;
    }
    _warnShown = false;
  }

  function updateCountdown() {
    var el = document.getElementById('session-countdown');
    if (!el) return;
    var m = Math.floor(_secondsLeft / 60);
    var s = _secondsLeft % 60;
    el.textContent = (m > 0 ? m + 'm ' : '') + s + 's';
    _secondsLeft--;
    if (_secondsLeft < 0) _secondsLeft = 0;
  }

  function showWarning() {
    if (_warnShown) return;
    _warnShown = true;
    createWarningBanner();
    _secondsLeft = Math.floor(WARNING_MS / 1000);
    updateCountdown();
    _countdownTimer = setInterval(updateCountdown, 1000);
  }

  function resetTimer() {
    if (!isAppPage()) return;
    clearTimeout(_timer);
    clearTimeout(_warnTimer);
    removeWarningBanner();

    // Set warning timer (fires 2 minutes before timeout)
    _warnTimer = setTimeout(showWarning, TIMEOUT_MS - WARNING_MS);

    // Set logout timer
    _timer = setTimeout(function () {
      removeWarningBanner();
      // Sign out via Supabase if available
      if (typeof Auth !== 'undefined' && Auth.signOut) {
        Auth.signOut().catch(function(){});
      } else if (typeof supabase !== 'undefined') {
        supabase.auth.signOut().catch(function(){});
      }
      // Redirect to login
      var base = window.location.pathname.replace(/\/app\/.*$/, '/app/');
      window.location.href = base + 'dashboard.html?session=expired';
    }, TIMEOUT_MS);
  }

  function keepAlive() {
    resetTimer();
  }

  // Start tracking once DOM is ready
  document.addEventListener('DOMContentLoaded', function () {
    if (!isAppPage()) return;

    // Activity events that reset the timer
    var events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    events.forEach(function (ev) {
      document.addEventListener(ev, resetTimer, { passive: true });
    });

    // Show expired message if redirected here after timeout
    if (window.location.search.includes('session=expired')) {
      setTimeout(function () {
        if (typeof Toast !== 'undefined') {
          Toast.show('Your session expired due to inactivity. Please sign in again.', 'warn', 5000);
        }
      }, 1000);
    }

    resetTimer(); // start the clock
  });

  // Expose keepAlive globally for the button onclick
  window.SessionTimeout = { keepAlive: keepAlive };
})();

/* -----------------------------------------------------------------
   INIT CALL
   ----------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  initContactForm();
});
