-- Customers who write to Boutik's number about a shop: which shop they are
-- asking about and the last few turns, so the answer follows the conversation.
create table if not exists boutik_wa_sessions (
  wa_from text primary key,
  shop_id uuid not null references boutik_shops(id) on delete cascade,
  history jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table boutik_wa_sessions enable row level security;
