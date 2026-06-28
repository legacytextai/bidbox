-- System-level key/value configuration store.
-- Used for one-time migration flags, feature toggles, and other global state
-- that doesn't belong in domain tables or work queues.
create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null default 'null',
  updated_at timestamptz not null default now()
);

-- Service role only — never exposed to client queries.
alter table app_settings enable row level security;
