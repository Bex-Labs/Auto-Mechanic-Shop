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
   INIT CALL
   ----------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  initContactForm();
});

/* -----------------------------------------------------------------
   VIN DECODER  — NHTSA free API, no key required
   Decodes a 17-character VIN and returns { make, model, year, bodyClass, fuelType }
   Automatically fills form fields and shows a status indicator.

   Usage:
     <input id="my-vin" oninput="vinDecode(event, 'my-vin', {
       make:  'my-make',
       model: 'my-model',
       year:  'my-year',
       color: 'my-color'
     })">
     <div id="my-vin-status"></div>
   ----------------------------------------------------------------- */

const VINDecoder = (() => {

  // Cache results so the same VIN doesn't hit the API twice
  const _cache = {};

  async function decode(vin) {
    const v = vin.trim().toUpperCase();
    if (v.length !== 17) return null;
    if (_cache[v]) return _cache[v];

    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${v}?format=json`;
    const res  = await fetch(url);
    if (!res.ok) throw new Error('NHTSA API unreachable');
    const json = await res.json();

    // Pull key fields out of the Results array
    const get = (variable) => {
      const row = (json.Results || []).find(r => r.Variable === variable);
      return row?.Value && row.Value !== 'Not Applicable' && row.Value !== '0' ? row.Value : null;
    };

    const result = {
      make:      get('Make'),
      model:     get('Model'),
      year:      get('Model Year'),
      bodyClass: get('Body Class'),
      fuelType:  get('Fuel Type - Primary'),
      drive:     get('Drive Type'),
      cylinders: get('Engine Number of Cylinders'),
      country:   get('Plant Country'),
      errorCode: get('Error Code'),          // '0' = no errors
      errorText: get('Error Text'),
    };

    // A valid decode has at least make + model
    if (!result.make && !result.model) {
      throw new Error('VIN not recognised — check the number and try again');
    }

    _cache[v] = result;
    return result;
  }

  return { decode };
})();

/**
 * Called oninput on any VIN field.
 * @param {Event}  e          - the input event
 * @param {string} vinId      - id of the VIN input
 * @param {object} fieldMap   - { make, model, year, color } — ids of fields to fill
 * @param {string} statusId   - id of the status div (defaults to vinId + '-status')
 */
async function vinDecode(e, vinId, fieldMap = {}, statusId) {
  const vinInput = document.getElementById(vinId);
  if (!vinInput) return;

  const vin      = vinInput.value.trim().toUpperCase();
  const sid      = statusId || vinId + '-status';
  const statusEl = document.getElementById(sid);

  // Keep VIN uppercase as user types
  vinInput.value = vin;

  // Only decode once we have all 17 characters
  if (vin.length < 17) {
    if (statusEl) {
      statusEl.innerHTML = vin.length > 0
        ? `<span style="color:var(--app-muted);font-family:var(--ff-mono);font-size:11px">${vin.length}/17 characters</span>`
        : '';
    }
    return;
  }

  if (vin.length > 17) {
    if (statusEl) statusEl.innerHTML = `<span style="color:#f87171;font-size:11px">⚠ VIN must be exactly 17 characters</span>`;
    return;
  }

  // Show loading
  if (statusEl) {
    statusEl.innerHTML = `
      <span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--app-muted)">
        <span style="width:11px;height:11px;border:2px solid var(--app-border);border-top-color:var(--amber);border-radius:50%;animation:spin 0.65s linear infinite;display:inline-block"></span>
        Looking up VIN…
      </span>`;
  }

  try {
    const info = await VINDecoder.decode(vin);
    if (!info) return;

    // Fill in the mapped fields (only if currently empty OR field is auto-fillable)
    const fill = (fieldId, value) => {
      if (!fieldId || !value) return;
      const el = document.getElementById(fieldId);
      if (el && !el.value) el.value = value;   // don't overwrite if already filled
    };

    // For year specifically, always overwrite since user can't know it from VIN
    const fillYear = (fieldId, value) => {
      if (!fieldId || !value) return;
      const el = document.getElementById(fieldId);
      if (el) el.value = value;
    };

    fill(fieldMap.make,  info.make ? _toTitleCase(info.make)   : null);
    fill(fieldMap.model, info.model ? _toTitleCase(info.model) : null);
    fillYear(fieldMap.year, info.year);

    // Build success banner
    const parts = [
      info.year, info.make ? _toTitleCase(info.make) : null,
      info.model ? _toTitleCase(info.model) : null
    ].filter(Boolean);

    const extras = [
      info.bodyClass, info.fuelType, info.drive,
      info.cylinders ? info.cylinders + '-cyl' : null,
    ].filter(Boolean).join(' · ');

    if (statusEl) {
      statusEl.innerHTML = `
        <div style="
          display:flex;align-items:flex-start;gap:8px;
          background:rgba(31,122,74,0.1);border:1px solid rgba(31,122,74,0.3);
          border-radius:6px;padding:8px 12px;margin-top:4px;
        ">
          <span style="font-size:16px;flex-shrink:0">✅</span>
          <div>
            <div style="font-size:12px;font-weight:700;color:#6ee7b7;line-height:1.4">${parts.join(' ')}</div>
            ${extras ? `<div style="font-size:11px;color:var(--app-muted);margin-top:2px">${extras}</div>` : ''}
            <div style="font-size:10px;color:var(--app-muted);margin-top:3px;font-family:var(--ff-mono);letter-spacing:0.3px">
              Fields auto-filled from VIN — review before saving
            </div>
          </div>
        </div>`;
    }

  } catch (err) {
    if (statusEl) {
      statusEl.innerHTML = `
        <div style="
          display:flex;align-items:center;gap:8px;
          background:rgba(181,43,30,0.1);border:1px solid rgba(181,43,30,0.3);
          border-radius:6px;padding:8px 12px;margin-top:4px;
          font-size:11px;color:#f87171;
        ">
          ⚠ ${err.message || 'Could not decode VIN — fill fields manually'}
        </div>`;
    }
  }
}

function _toTitleCase(str) {
  if (!str) return str;
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}
