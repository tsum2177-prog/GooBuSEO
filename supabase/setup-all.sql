-- ============================================================
-- レビュー返信AI セットアップSQL（Supabase SQL Editor用）
-- migrations/ 以下のファイルを順番に連結したものです。
-- 修正は migrations/ 側で行い、このファイルは再生成してください。
--
-- 使い方: Supabase ダッシュボード > SQL Editor > New query に貼り付けて Run
-- 同じスクリプトは何度実行してもエラーになりません（drop policy if exists / create table if not exists を使用）。
-- ============================================================

-- ---------- 20261019120000_create_profiles.sql ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  subscription_status text not null default 'none'
    check (subscription_status in ('none', 'active', 'past_due', 'canceled')),
  stripe_customer_id text unique,
  stripe_price_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles
  for select
  using (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();


-- ---------- 20261020120000_create_shop_settings.sql ----------
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


-- ---------- 20261020120100_create_reviews.sql ----------
-- レビュー履歴（Googleマップから取得した口コミ）
begin;

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  location_id text,
  external_id text not null,
  author_name text,
  rating integer not null check (rating between 1 and 5),
  content text,
  published_at timestamptz,
  reply_text text,
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, external_id)
);

alter table public.reviews enable row level security;

drop policy if exists "reviews_select_own" on public.reviews;
create policy "reviews_select_own"
  on public.reviews
  for select
  using (auth.uid() = user_id);

create index if not exists reviews_user_id_published_at_idx
  on public.reviews (user_id, published_at desc);

commit;


-- ---------- 20261020120200_create_gbp_connections.sql ----------
-- Google Business Profile連携（OAuthトークンの保存先）
begin;

create table if not exists public.gbp_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  google_account_id text not null,
  google_account_name text,
  location_id text not null,
  location_title text,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, location_id)
);

alter table public.gbp_connections enable row level security;

drop policy if exists "gbp_connections_select_own" on public.gbp_connections;
create policy "gbp_connections_select_own"
  on public.gbp_connections
  for select
  using (auth.uid() = user_id);

drop policy if exists "gbp_connections_delete_own" on public.gbp_connections;
create policy "gbp_connections_delete_own"
  on public.gbp_connections
  for delete
  using (auth.uid() = user_id);

drop trigger if exists gbp_connections_set_updated_at on public.gbp_connections;
create trigger gbp_connections_set_updated_at
  before update on public.gbp_connections
  for each row
  execute function public.set_updated_at();

commit;


-- ---------- 20261020120300_add_category_and_auto_reply.sql ----------
-- 店舗設定の拡張（業種・自動返信の有効/無効）と、返信の自動投稿フラグ
begin;

alter table public.shop_settings
  add column if not exists category text;

alter table public.shop_settings
  add column if not exists auto_reply_enabled boolean not null default false;

alter table public.reviews
  add column if not exists auto_replied boolean not null default false;

commit;



-- ---------- 20261020120400_add_claim_and_preserve_reply.sql ----------
-- 自動返信の排他制御（claimed_at）と、返信履歴の保持トリガーを追加
begin;

alter table public.reviews
  add column if not exists claimed_at timestamptz;

create index if not exists reviews_user_id_claimed_at_idx
  on public.reviews (user_id, claimed_at);

create or replace function public.preserve_review_reply()
returns trigger
language plpgsql
as $$
begin
  if old.reply_text is not null and new.reply_text is null then
    new.reply_text = old.reply_text;
    new.replied_at = old.replied_at;
  end if;
  return new;
end;
$$;

drop trigger if exists reviews_preserve_reply on public.reviews;
create trigger reviews_preserve_reply
  before update on public.reviews
  for each row
  execute function public.preserve_review_reply();

commit;


-- ---------- 20261020120500_add_connection_status.sql ----------
-- Google連携の失効状態を管理する status カラムを追加
begin;

alter table public.gbp_connections
  add column if not exists status text not null default 'active';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'gbp_connections_status_check'
      and conrelid = 'public.gbp_connections'::regclass
  ) then
    alter table public.gbp_connections
      add constraint gbp_connections_status_check
      check (status in ('active', 'revoked'));
  end if;
end
$$;

commit;


-- ---------- 20261020120600_limit_gbp_connections_grant.sql ----------
-- gbp_connections の暗号化トークン列を、本人ブラウザから読めないようにする
begin;

revoke select on public.gbp_connections from authenticated;

grant select (
  id,
  user_id,
  google_account_id,
  google_account_name,
  location_id,
  location_title,
  status,
  created_at,
  updated_at
) on public.gbp_connections to authenticated;

commit;


-- ---------- 20261020120700_create_stripe_events.sql ----------
-- Stripe webhook の重複処理を防ぐテーブルと、遅延イベントで上書きしないための列
begin;

create table if not exists public.stripe_events (
  id text primary key,
  created_at timestamptz not null default now()
);

alter table public.stripe_events enable row level security;

alter table public.profiles
  add column if not exists stripe_event_created_at timestamptz;

commit;


-- ---------- 20261020120800_add_reply_source.sql ----------
-- 返信の「出所」を記録する posted_via 列を追加
begin;

alter table public.reviews
  add column if not exists posted_via text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reviews_posted_via_check'
      and conrelid = 'public.reviews'::regclass
  ) then
    alter table public.reviews
      add constraint reviews_posted_via_check
      check (posted_via in ('ai_manual', 'ai_auto'));
  end if;
end
$$;

commit;


-- ============================================================
-- 実行結果の確認
--   shop_settings: category / auto_reply_enabled
--   reviews: auto_replied / claimed_at / posted_via
--   gbp_connections: status
--   profiles: stripe_event_created_at
--   stripe_events テーブル
--   が表示されていれば成功です。
-- ============================================================
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and table_name in ('profiles', 'shop_settings', 'reviews', 'gbp_connections', 'stripe_events')
order by table_name, column_name;
