// ── SUPABASE CLIENT ──────────────────────────────────────────────────────────
const fetch = require('node-fetch');

const SUPABASE_URL = 'https://qzhyzahoiqnuuubuhuuh.supabase.co';
const SUPABASE_KEY = 'sb_publishable_JcNrU7QnWEh9nddlBCg8Rg_deI_aLBx';

const headers = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
};

async function sbFetch(method, table, body = null, query = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${method} ${table}: ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ── SIGNAL OPERATIONS ────────────────────────────────────────────────────────

async function createSignal(signal) {
  try {
    const row = {
      signal_id:  signal.id,
      script:     signal.script || 'USD/JPY',
      direction:  signal.direction,
      entry:      parseFloat(signal.entry),
      sl:         parseFloat(signal.sl),
      tp:         parseFloat(signal.tp),
      lots:       0.01,
      status:     'active',
      created_at: new Date().toISOString(),
    };
    const result = await sbFetch('POST', 'cpr_signals', row);
    console.log('[SUPABASE] Signal created:', signal.id);
    return result;
  } catch(e) {
    console.error('[SUPABASE] createSignal error:', e.message);
  }
}

async function updateSignalStatus(signalId, status) {
  try {
    await sbFetch('PATCH', 'cpr_signals', { status, updated_at: new Date().toISOString() },
      `?signal_id=eq.${signalId}`);
    console.log('[SUPABASE] Signal updated:', signalId, '->', status);
  } catch(e) {
    console.error('[SUPABASE] updateSignalStatus error:', e.message);
  }
}

async function getLastSignalId() {
  try {
    const rows = await sbFetch('GET', 'cpr_signals', null,
      '?order=created_at.desc&limit=1&status=neq.active');
    if (rows && rows.length > 0) return rows[0].signal_id;
    return 0;
  } catch(e) {
    console.error('[SUPABASE] getLastSignalId error:', e.message);
    return 0;
  }
}

async function createTrade(trade) {
  try {
    const row = {
      signal_id:       trade.signalId,
      ticket:          trade.ticket,
      script:          'USD/JPY',
      direction:       trade.direction,
      entry_price:     parseFloat(trade.entryPrice),
      sl:              parseFloat(trade.sl),
      tp:              parseFloat(trade.tp),
      lots:            0.01,
      status:          'open',
      created_at:      new Date().toISOString(),
    };
    const result = await sbFetch('POST', 'cpr_trades', row);
    console.log('[SUPABASE] Trade created, ticket:', trade.ticket);
    return result;
  } catch(e) {
    console.error('[SUPABASE] createTrade error:', e.message);
  }
}

async function getRecentTrades(limit = 20) {
  try {
    return await sbFetch('GET', 'cpr_trades', null,
      `?order=created_at.desc&limit=${limit}`);
  } catch(e) {
    console.error('[SUPABASE] getRecentTrades error:', e.message);
    return [];
  }
}

async function getRecentSignals(limit = 20) {
  try {
    return await sbFetch('GET', 'cpr_signals', null,
      `?order=created_at.desc&limit=${limit}`);
  } catch(e) {
    console.error('[SUPABASE] getRecentSignals error:', e.message);
    return [];
  }
}

// ── SETUP TABLES (run once) ──────────────────────────────────────────────────
async function setupTables() {
  // We'll use Supabase SQL editor for this — just test connection here
  try {
    await sbFetch('GET', 'cpr_signals', null, '?limit=1');
    console.log('[SUPABASE] Connected — cpr_signals table OK');
  } catch(e) {
    console.error('[SUPABASE] Table not found — run SQL setup first:', e.message);
  }
}

async function closeTrade(ticket, closePrice, pnl, reason) {
  try {
    await sbFetch('PATCH', 'cpr_trades',
      {
        status:     'closed',
        pnl:        parseFloat(pnl),
        close_price: parseFloat(closePrice),
        close_reason: reason,
        closed_at:  new Date().toISOString(),
      },
      `?ticket=eq.${ticket}`
    );
    console.log('[SUPABASE] Trade closed:', ticket, 'pnl:', pnl, 'reason:', reason);
  } catch(e) {
    console.error('[SUPABASE] closeTrade error:', e.message);
  }
}

module.exports = { createSignal, updateSignalStatus, getLastSignalId, createTrade, closeTrade, getRecentTrades, getRecentSignals, setupTables };
