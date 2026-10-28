-- Boutik: shops, scans, products, the picture memory, corrections and orders.
-- Tables carry the boutik_ prefix because they share a database with another
-- One Market product during the hackathon.

create extension if not exists pgcrypto;

create table if not exists boutik_shops (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  whatsapp text not null,            -- E.164 digits, e.g. 2376XXXXXXXX
  city text not null default 'Douala',
  quarter text not null default '',
  language text not null default 'fr' check (language in ('fr', 'en')),
  -- Secret the trader's phone keeps; it is the only way to change the shop.
  manage_token text not null unique default encode(gen_random_bytes(18), 'hex'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists boutik_scans (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references boutik_shops(id) on delete cascade,
  status text not null default 'done' check (status in ('running', 'done', 'confirmed', 'failed')),
  video jsonb not null default '{}'::jsonb,
  frames jsonb not null default '[]'::jsonb,
  identify jsonb not null default '{}'::jsonb,
  prices jsonb not null default '{}'::jsonb,
  counts jsonb not null default '{}'::jsonb,
  model_calls integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists boutik_scans_shop_idx on boutik_scans(shop_id, created_at desc);

create table if not exists boutik_products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references boutik_shops(id) on delete cascade,
  catalog_id text,                    -- entry in the built-in catalogue, when recognised
  name text not null,
  brand text not null default '',
  unit text not null default 'piece',
  description text not null default '',
  image_url text,                     -- catalogue photo (Muse Image) or a real picture
  stock integer not null default 0,
  stock_hint integer,                 -- the model's higher estimate, shown as "maybe up to"
  price integer,                      -- FCFA for one unit
  currency text not null default 'XAF',
  price_per text not null default '',
  published boolean not null default false,
  needs_check text[] not null default '{}',
  sort integer not null default 0,
  last_scan_id uuid references boutik_scans(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists boutik_products_shop_idx on boutik_products(shop_id, sort);

-- The picture memory: a close-up of one unit, tied to a catalogue entry and/or a shop's product.
create table if not exists boutik_pictures (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references boutik_shops(id) on delete cascade,
  product_id uuid references boutik_products(id) on delete cascade,
  catalog_id text,
  storage_path text not null,
  source text not null default 'scan' check (source in ('seed', 'scan', 'confirmed')),
  scan_id uuid references boutik_scans(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists boutik_pictures_catalog_idx on boutik_pictures(catalog_id) where catalog_id is not null;
create index if not exists boutik_pictures_shop_idx on boutik_pictures(shop_id);

-- What the trader changed after a scan: the lessons the counter learns from.
create table if not exists boutik_corrections (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references boutik_shops(id) on delete cascade,
  scan_id uuid references boutik_scans(id) on delete set null,
  product_id uuid references boutik_products(id) on delete set null,
  catalog_id text,
  field text not null check (field in ('count', 'price', 'name', 'brand', 'catalog', 'removed', 'added', 'merged')),
  machine jsonb not null default '{}'::jsonb,   -- what the scan said (value, method, shape word)
  human jsonb not null default '{}'::jsonb,     -- what the trader set
  created_at timestamptz not null default now()
);
create index if not exists boutik_corrections_shop_idx on boutik_corrections(shop_id, created_at desc);

create table if not exists boutik_orders (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references boutik_shops(id) on delete cascade,
  items jsonb not null default '[]'::jsonb,     -- [{productId, name, qty, price}]
  total integer not null default 0,
  currency text not null default 'XAF',
  buyer_name text not null default '',
  buyer_phone text not null default '',
  note text not null default '',
  status text not null default 'new' check (status in ('new', 'confirmed', 'delivered', 'cancelled')),
  created_at timestamptz not null default now()
);
create index if not exists boutik_orders_shop_idx on boutik_orders(shop_id, created_at desc);

-- Row security: the public reads shops and published products and may place an order;
-- everything else goes through the server with the service key.
alter table boutik_shops enable row level security;
alter table boutik_scans enable row level security;
alter table boutik_products enable row level security;
alter table boutik_pictures enable row level security;
alter table boutik_corrections enable row level security;
alter table boutik_orders enable row level security;

drop policy if exists boutik_products_public_read on boutik_products;
create policy boutik_products_public_read on boutik_products for select to anon, authenticated using (published);
drop policy if exists boutik_orders_public_insert on boutik_orders;
create policy boutik_orders_public_insert on boutik_orders for insert to anon, authenticated with check (status = 'new');

-- manage_token must never reach the public: no direct read of boutik_shops; this view
-- (owner's rights, so it bypasses row security) exposes only the safe columns.
create or replace view boutik_shops_public with (security_invoker = false) as
  select id, slug, name, whatsapp, city, quarter, language, created_at from boutik_shops;
grant select on boutik_shops_public to anon, authenticated;

-- Public pictures bucket for the memory and catalogue photos.
insert into storage.buckets (id, name, public)
  values ('boutik', 'boutik', true)
  on conflict (id) do nothing;
drop policy if exists boutik_pictures_public_read on storage.objects;
create policy boutik_pictures_public_read on storage.objects for select to anon, authenticated using (bucket_id = 'boutik');
