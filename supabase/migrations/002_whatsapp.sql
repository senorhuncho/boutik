-- WhatsApp: videos sent to Boutik's number become scan jobs the trader opens from a link; every inbound message is handled once.
create table if not exists boutik_jobs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references boutik_shops(id) on delete cascade,
  video_path text not null,
  status text not null default 'ready' check (status in ('ready', 'opened', 'done', 'failed')),
  created_at timestamptz not null default now(),
  opened_at timestamptz
);
create index if not exists boutik_jobs_shop_idx on boutik_jobs(shop_id, created_at desc);
alter table boutik_jobs enable row level security;

create table if not exists boutik_wa_messages (
  id text primary key,
  wa_from text not null,
  kind text not null,
  received_at timestamptz not null default now()
);
alter table boutik_wa_messages enable row level security;
