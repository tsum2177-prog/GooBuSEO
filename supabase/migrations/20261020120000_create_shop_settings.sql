-- 店舗設定（自店舗の強み・SEOキーワード）
begin;

create table if not exists public.shop_settings (
  id uuid primary key references auth.users (id) on delete cascade,
  shop_name text,
  strengths text not null default '',
  seo_keywords text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.shop_settings enable row level security;

drop policy if exists "shop_settings_select_own" on public.shop_settings;
create policy "shop_settings_select_own"
  on public.shop_settings
  for select
  using (auth.uid() = id);

drop policy if exists "shop_settings_insert_own" on public.shop_settings;
create policy "shop_settings_insert_own"
  on public.shop_settings
  for insert
  with check (auth.uid() = id);

drop policy if exists "shop_settings_update_own" on public.shop_settings;
create policy "shop_settings_update_own"
  on public.shop_settings
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop trigger if exists shop_settings_set_updated_at on public.shop_settings;
create trigger shop_settings_set_updated_at
  before update on public.shop_settings
  for each row
  execute function public.set_updated_at();

commit;
