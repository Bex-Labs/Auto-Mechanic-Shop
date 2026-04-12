import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim();
    if (!token) return new Response(JSON.stringify({ error: 'No token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: { user }, error: userErr } = await adminClient.auth.getUser(token);
    if (userErr || !user) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: profile } = await adminClient.from('profiles').select('shop_id, role').eq('id', user.id).single();

    if (!profile) {
      await adminClient.auth.admin.deleteUser(user.id);
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const isAdmin = profile.role === 'Admin';
    const shopId  = profile.shop_id;

    if (isAdmin && shopId) {
      // Get PO ids and delete purchase_order_items first (FK to inventory)
      const { data: pos } = await adminClient.from('purchase_orders').select('id').eq('shop_id', shopId);
      const poIds = (pos || []).map((p) => p.id);
      if (poIds.length) await adminClient.from('purchase_order_items').delete().in('po_id', poIds);

      // Get WO ids and delete work_order_parts (FK to inventory)
      const { data: wos } = await adminClient.from('work_orders').select('id').eq('shop_id', shopId);
      const woIds = (wos || []).map((w) => w.id);
      if (woIds.length) {
        await adminClient.from('work_order_parts').delete().in('work_order_id', woIds);
        await adminClient.from('wo_status_history').delete().in('work_order_id', woIds);
      }

      // Delete invoice_payments
      const { data: invs } = await adminClient.from('invoices').select('id').eq('shop_id', shopId);
      const invIds = (invs || []).map((i) => i.id);
      if (invIds.length) await adminClient.from('invoice_payments').delete().in('invoice_id', invIds);

      // Delete other tables
      await adminClient.from('staff_invites').delete().eq('shop_id', shopId);
      await adminClient.from('billing_transactions').delete().eq('shop_id', shopId);

      // Delete shop — cascades the rest
      const { error: shopErr } = await adminClient.from('shops').delete().eq('id', shopId);
      if (shopErr) return new Response(JSON.stringify({ error: 'Failed to delete shop: ' + shopErr.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } else {
      await adminClient.from('profiles').delete().eq('id', user.id);
    }

    await adminClient.auth.admin.deleteUser(user.id);
    return new Response(JSON.stringify({ success: true, message: 'Account permanently deleted' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Internal server error: ' + err.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
