-- CPR Radar — Supabase Setup
-- Run this in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/qzhyzahoiqnuuubuhuuh/sql

-- ── SIGNALS TABLE ────────────────────────────────────────────────────
create table if not exists cpr_signals (
  id          bigserial primary key,
  signal_id   bigint unique not null,
  script      text default 'USD/JPY',
  direction   text not null,
  entry       numeric(10,5) not null,
  sl          numeric(10,5) not null,
  tp          numeric(10,5) not null,
  lots        numeric(5,2)  default 0.01,
  status      text default 'active',  -- active / sent / executed / failed
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ── TRADES TABLE ─────────────────────────────────────────────────────
create table if not exists cpr_trades (
  id           bigserial primary key,
  signal_id    bigint references cpr_signals(signal_id),
  ticket       bigint unique,
  script       text default 'USD/JPY',
  direction    text not null,
  entry_price  numeric(10,5),
  sl           numeric(10,5),
  tp           numeric(10,5),
  lots         numeric(5,2)  default 0.01,
  close_price  numeric(10,5),
  close_reason text,                   -- TP / SL / MANUAL
  pnl          numeric(10,2),
  status       text default 'open',   -- open / closed / cancelled
  created_at   timestamptz default now(),
  closed_at    timestamptz
);

-- ── INDEXES ──────────────────────────────────────────────────────────
create index if not exists idx_signals_status   on cpr_signals(status);
create index if not exists idx_signals_created  on cpr_signals(created_at desc);
create index if not exists idx_trades_ticket    on cpr_trades(ticket);
create index if not exists idx_trades_created   on cpr_trades(created_at desc);

-- ── RLS POLICIES ─────────────────────────────────────────────────────
alter table cpr_signals enable row level security;
alter table cpr_trades  enable row level security;

drop policy if exists "allow all" on cpr_signals;
drop policy if exists "allow all" on cpr_trades;

create policy "allow all" on cpr_signals for all using (true) with check (true);
create policy "allow all" on cpr_trades  for all using (true) with check (true);
