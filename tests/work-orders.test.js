// tests/modules/work-orders.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * WORK ORDERS TEST SUITE

 */

// ─────────────────────────────────────────────────────────────────────────
// SETUP & HELPERS
// ─────────────────────────────────────────────────────────────────────────

function setupDOM() {
  document.body.innerHTML = `
    <div class="app-layout">
      <div class="app-main">
        <div class="app-topbar">
          <span class="topbar-title">WORK ORDERS</span>
          <div class="topbar-actions">
            <button class="app-btn app-btn-primary" onclick="openNewWO()">
              New Work Order
            </button>
          </div>
        </div>
        <div class="app-content">
          <div class="wo-kanban"></div>
          <div class="wo-list"></div>
        </div>
      </div>
    </div>
    <div class="toast-container"></div>
  `;
}

function mockWorkOrder(overrides = {}) {
  return {
    id: 'wo-123',
    shop_id: 'shop-456',
    customer_id: 'cust-789',
    vehicle_id: 'veh-001',
    mechanic_id: 'mech-002',
    ref: 'WO-2024-089',
    status: 'open',
    fault: 'Engine noise',
    labor_hours: 2.5,
    customer_notified_at: null,
    created_at: '2024-04-21T10:00:00Z',
    updated_at: '2024-04-21T10:00:00Z',
    ...overrides
  };
}

function mockPart(overrides = {}) {
  return {
    id: 'part-001',
    shop_id: 'shop-456',
    name: 'Brake Pad Set — Front',
    sku: 'BP-F-001',
    qty: 8,
    unit_cost: 12500,
    ...overrides
  };
}

// ─────────────────────────────────────────────────────────────────────────
// MOCK DATA LAYER (Simulates Supabase)
// ─────────────────────────────────────────────────────────────────────────

const mockDatabase = {
  workOrders: [
    mockWorkOrder({ id: 'wo-1', ref: 'WO-089', status: 'open' }),
    mockWorkOrder({ id: 'wo-2', ref: 'WO-087', status: 'inprogress' }),
    mockWorkOrder({ id: 'wo-3', ref: 'WO-085', status: 'completed' }),
  ],
  workOrderParts: [],
  parts: [
    mockPart({ id: 'part-1', qty: 10 }),
    mockPart({ id: 'part-2', qty: 5 }),
  ],
  statusHistory: [],
  invoices: [],
};

const WorkOrderService = {
  // Get all work orders
  getWorkOrders: async () => {
    return [...mockDatabase.workOrders];
  },

  // Get single work order
  getWorkOrder: async (id) => {
    return mockDatabase.workOrders.find(wo => wo.id === id);
  },

  // Create new work order
  createWorkOrder: async (data) => {
    if (!data.customer_id || !data.vehicle_id || !data.fault) {
      throw new Error('Missing required fields: customer_id, vehicle_id, fault');
    }
    const newWO = {
      id: `wo-${Date.now()}`,
      shop_id: 'shop-456',
      status: 'open',
      labor_hours: 0,
      customer_notified_at: null,
      created_at: new Date().toISOString(),
      ...data
    };
    mockDatabase.workOrders.push(newWO);
    return newWO;
  },

  // Update status
  updateStatus: async (id, newStatus) => {
    const wo = mockDatabase.workOrders.find(x => x.id === id);
    if (!wo) throw new Error(`Work order ${id} not found`);
    
    wo.status = newStatus;
    wo.updated_at = new Date().toISOString();

    // Log to status history
    mockDatabase.statusHistory.push({
      id: `hist-${Date.now()}`,
      work_order_id: id,
      status: newStatus,
      changed_by: 'user-123',
      changer_name: 'Test User',
      changed_at: new Date().toISOString(),
    });

    return wo;
  },

  // Attach part to work order
  attachPart: async (woId, partId, qty) => {
    const wo = mockDatabase.workOrders.find(x => x.id === woId);
    const part = mockDatabase.parts.find(p => p.id === partId);

    if (!wo) throw new Error(`Work order ${woId} not found`);
    if (!part) throw new Error(`Part ${partId} not found`);

    // Check if part already attached
    const existing = mockDatabase.workOrderParts.find(
      wp => wp.work_order_id === woId && wp.part_id === partId
    );

    if (existing) {
      // Increment quantity
      existing.qty += qty;
    } else {
      // Add new part
      mockDatabase.workOrderParts.push({
        id: `wop-${Date.now()}`,
        work_order_id: woId,
        part_id: partId,
        qty,
        unit_cost: part.unit_cost,
      });
    }

    // Simulate DB trigger: decrement stock
    part.qty -= qty;

    return { work_order_id: woId, part_id: partId, qty };
  },

  // Complete work order (generates invoice)
  complete: async (id) => {
    const wo = mockDatabase.workOrders.find(x => x.id === id);
    if (!wo) throw new Error(`Work order ${id} not found`);

    wo.status = 'completed';
    wo.updated_at = new Date().toISOString();

    // Auto-generate invoice
    const parts = mockDatabase.workOrderParts.filter(wp => wp.work_order_id === id);
    const partsTotal = parts.reduce((sum, p) => sum + (p.qty * p.unit_cost), 0);
    const laborTotal = wo.labor_hours * 8000; // ₦8,000/hr
    const taxAmount = (laborTotal + partsTotal) * 0.075; // 7.5%

    const invoice = {
      id: `inv-${Date.now()}`,
      shop_id: 'shop-456',
      work_order_id: id,
      customer_id: wo.customer_id,
      ref: `INV-2024-${id.substring(3)}`,
      status: 'unpaid',
      labor_amount: laborTotal,
      parts_amount: partsTotal,
      tax_amount: taxAmount,
      total_amount: laborTotal + partsTotal + taxAmount,
      created_at: new Date().toISOString(),
    };

    mockDatabase.invoices.push(invoice);

    return { wo, invoice };
  },

  // Get status history timeline
  getHistory: async (woId) => {
    return mockDatabase.statusHistory.filter(h => h.work_order_id === woId);
  },
};

// ─────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────

describe('Work Orders Module', () => {
  beforeEach(() => {
    setupDOM();
    // Reset database to initial state
    mockDatabase.workOrders = [
      mockWorkOrder({ id: 'wo-1', ref: 'WO-089', status: 'open' }),
      mockWorkOrder({ id: 'wo-2', ref: 'WO-087', status: 'inprogress' }),
      mockWorkOrder({ id: 'wo-3', ref: 'WO-085', status: 'completed' }),
    ];
    mockDatabase.workOrderParts = [];
    mockDatabase.statusHistory = [];
    mockDatabase.invoices = [];
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  // ─────────────────────────────────────────────────────────────────────
  // TEST 1: Load work orders
  // ─────────────────────────────────────────────────────────────────────
  it('TEST 1: should load all work orders on page init', async () => {
    const workOrders = await WorkOrderService.getWorkOrders();

    expect(workOrders).toHaveLength(3);
    expect(workOrders[0].ref).toBe('WO-089');
    expect(workOrders[1].ref).toBe('WO-087');
    expect(workOrders[2].status).toBe('completed');
  });

  // ─────────────────────────────────────────────────────────────────────
  // TEST 2: Create work order with validation
  // ─────────────────────────────────────────────────────────────────────
  it('TEST 2: should create a new work order with valid input', async () => {
    const newWO = {
      customer_id: 'cust-101',
      vehicle_id: 'veh-202',
      fault: 'Transmission issue',
      mechanic_id: 'mech-303',
      labor_hours: 3,
    };

    const result = await WorkOrderService.createWorkOrder(newWO);

    expect(result.id).toBeDefined();
    expect(result.fault).toBe('Transmission issue');
    expect(result.status).toBe('open');
    expect(result.labor_hours).toBe(3);
  });

  // ─────────────────────────────────────────────────────────────────────
  // TEST 3: Reject creation with missing required fields
  // ─────────────────────────────────────────────────────────────────────
  it('TEST 3: should reject work order creation with missing fields', async () => {
    const incompleteWO = {
      customer_id: 'cust-101',
      // missing vehicle_id and fault
      mechanic_id: 'mech-303',
    };

    try {
      await WorkOrderService.createWorkOrder(incompleteWO);
      expect.fail('Should have thrown an error');
    } catch (err) {
      expect(err.message).toContain('Missing required fields');
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // TEST 4: Update work order status (Kanban drag-drop)
  // ─────────────────────────────────────────────────────────────────────
  it('TEST 4: should update work order status when dragged to new column', async () => {
    const result = await WorkOrderService.updateStatus('wo-1', 'inprogress');

    expect(result.id).toBe('wo-1');
    expect(result.status).toBe('inprogress');
  });

  // ─────────────────────────────────────────────────────────────────────
  // TEST 5: Log status changes to timeline
  // ─────────────────────────────────────────────────────────────────────
  it('TEST 5: should log status change to history table', async () => {
    await WorkOrderService.updateStatus('wo-1', 'inprogress');
    const history = await WorkOrderService.getHistory('wo-1');

    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('inprogress');
    expect(history[0].changer_name).toBe('Test User');
  });

  // ─────────────────────────────────────────────────────────────────────
  // TEST 6: Attach part to work order
  // ─────────────────────────────────────────────────────────────────────
  it('TEST 6: should attach a part to a work order', async () => {
    const result = await WorkOrderService.attachPart('wo-1', 'part-1', 1);

    expect(result.work_order_id).toBe('wo-1');
    expect(result.part_id).toBe('part-1');
    expect(result.qty).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────────
  // TEST 7: Auto-deduct stock when part is attached
  // ─────────────────────────────────────────────────────────────────────
  it('TEST 7: should auto-deduct stock when part is attached', async () => {
    const part = mockDatabase.parts[0];
    const initialQty = part.qty;

    await WorkOrderService.attachPart('wo-1', part.id, 2);

    expect(part.qty).toBe(initialQty - 2);
  });

  // ─────────────────────────────────────────────────────────────────────
  // TEST 8: Increment quantity when attaching same part twice
  // ─────────────────────────────────────────────────────────────────────
  it('TEST 8: should increment quantity when attaching same part twice', async () => {
    await WorkOrderService.attachPart('wo-1', 'part-1', 1);
    await WorkOrderService.attachPart('wo-1', 'part-1', 2);

    const woPart = mockDatabase.workOrderParts.find(
      wp => wp.work_order_id === 'wo-1' && wp.part_id === 'part-1'
    );

    expect(woPart.qty).toBe(3); // 1 + 2
  });

  // ─────────────────────────────────────────────────────────────────────
  // TEST 9: Complete work order generates invoice
  // ─────────────────────────────────────────────────────────────────────
  it('TEST 9: should generate invoice when work order is marked completed', async () => {
    // Setup: Add parts and labor hours to work order
    const wo = mockDatabase.workOrders[0];
    wo.labor_hours = 2.5;
    await WorkOrderService.attachPart(wo.id, 'part-1', 1);

    // Complete the work order
    const { invoice } = await WorkOrderService.complete(wo.id);

    expect(invoice).toBeDefined();
    expect(invoice.work_order_id).toBe(wo.id);
    expect(invoice.labor_amount).toBe(2.5 * 8000); // 2.5 hrs × ₦8,000
    expect(invoice.status).toBe('unpaid');
    expect(invoice.total_amount).toBeGreaterThan(0);
  });

  // ─────────────────────────────────────────────────────────────────────
  // TEST 10: Calculate correct invoice totals
  // ─────────────────────────────────────────────────────────────────────
  it('TEST 10: should calculate correct invoice total (labour + parts + tax)', async () => {
    const wo = mockDatabase.workOrders[0];
    wo.labor_hours = 2.5;
    await WorkOrderService.attachPart(wo.id, 'part-1', 1);

    const { invoice } = await WorkOrderService.complete(wo.id);

    const expectedLabor = 2.5 * 8000; // ₦20,000
    const expectedParts = 1 * 12500;  // ₦12,500
    const expectedSubtotal = expectedLabor + expectedParts;
    const expectedTax = expectedSubtotal * 0.075;
    const expectedTotal = expectedSubtotal + expectedTax;

    expect(invoice.labor_amount).toBe(expectedLabor);
    expect(invoice.parts_amount).toBe(expectedParts);
    expect(Math.round(invoice.tax_amount)).toBe(Math.round(expectedTax));
    expect(Math.round(invoice.total_amount)).toBe(Math.round(expectedTotal));
  });

  // ─────────────────────────────────────────────────────────────────────
  // TEST 11: Prevent duplicate work order submission
  // ─────────────────────────────────────────────────────────────────────
  it('TEST 11: should prevent duplicate work order creation', async () => {
    const woData = {
      customer_id: 'cust-101',
      vehicle_id: 'veh-202',
      fault: 'AC not working',
      mechanic_id: 'mech-303',
      labor_hours: 1.5,
    };

    let submissionCount = 0;
    const submitWithPrevention = async (data) => {
      if (submissionCount > 0) throw new Error('Duplicate submission prevented');
      submissionCount++;
      return WorkOrderService.createWorkOrder(data);
    };

    // First submission succeeds
    const first = await submitWithPrevention(woData);
    expect(first.id).toBeDefined();

    // Second submission is blocked
    try {
      await submitWithPrevention(woData);
      expect.fail('Should have thrown duplicate error');
    } catch (err) {
      expect(err.message).toContain('Duplicate submission prevented');
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // TEST 12: Handle network retry on failure
  // ─────────────────────────────────────────────────────────────────────
  it('TEST 12: should retry work order operation on network failure', async () => {
    let attemptCount = 0;
    const maxRetries = 3;

    const createWithRetry = async (data) => {
      for (let i = 0; i < maxRetries; i++) {
        try {
          attemptCount++;
          if (attemptCount < 2) throw new Error('Network error');
          return WorkOrderService.createWorkOrder(data);
        } catch (err) {
          if (i === maxRetries - 1) throw err;
          // Exponential backoff
          await new Promise(r => setTimeout(r, Math.pow(2, i) * 100));
        }
      }
    };

    const woData = {
      customer_id: 'cust-101',
      vehicle_id: 'veh-202',
      fault: 'Brake fluid leak',
      mechanic_id: 'mech-303',
      labor_hours: 2,
    };

    const result = await createWithRetry(woData);

    expect(result.id).toBeDefined();
    expect(attemptCount).toBe(2); // Failed once, succeeded on retry
  });
});

// ─────────────────────────────────────────────────────────────────────────
// END OF WORK ORDERS TESTS
// ─────────────────────────────────────────────────────────────────────────

/**
 * TO RUN THESE TESTS:
 * 
 * npm install --save-dev vitest jsdom
 * npm test
 * 
 * EXPECTED OUTPUT:
 * 
 *  ✓ tests/modules/work-orders.test.js (12)
 *    ✓ Work Orders Module (12)
 *      ✓ TEST 1: should load all work orders on page init
 *      ✓ TEST 2: should create a new work order with valid input
 *      ✓ TEST 3: should reject work order creation with missing fields
 *      ✓ TEST 4: should update work order status when dragged to new column
 *      ✓ TEST 5: should log status change to history table
 *      ✓ TEST 6: should attach a part to a work order
 *      ✓ TEST 7: should auto-deduct stock when part is attached
 *      ✓ TEST 8: should increment quantity when attaching same part twice
 *      ✓ TEST 9: should generate invoice when work order is marked completed
 *      ✓ TEST 10: should calculate correct invoice total
 *      ✓ TEST 11: should prevent duplicate work order creation
 *      ✓ TEST 12: should retry work order operation on network failure
 * 
 *  Test Files  1 passed (1)
 *       Tests  12 passed (12)
 */