-- ============================================================
-- レビュー返信AI セットアップSQL（Supabase SQL Editor用）
-- migrations/ 以下のファイルを順番に連結したものです。
-- このファイルは手で編集しないでください。
-- scripts/generate-setup-all.ts で再生成してください。
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
--
-- 1) claimed_at
--    同時実行（cron と手動操作の重なり）で同じレビューへ二重投稿されないよう、
--    処理対象の行を条件付きUPDATEで排他的に確保する。
--
-- 2) preserve_review_reply
--    GBPのレビュー取得レスポンスに reviewReply が含まれない場合に、
--    ローカルに保存済みの返信履歴を NULL で上書きしないためのトリガー。
--    ここが奪われると「未返信」と判定され、同じレビューへ再度投稿され、
--    公開されている返信が別の文章に上書きされてしまう。
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
-- Google連携の失効状態を管理する `status` カラムを追加
--
-- refresh token はユーザーによる権限解除などで失効すると、
-- リフレッシュが成功し続けられなくなります。
-- 失効した連携を `revoked` として保存することで、
-- 毎時同じトークンを叩き続けるのをやめ、再連絡を案内できます。
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
--
-- アプリは gbp_connections を service role クライアントでしか読み書きしておらず、
-- ユーザー権限での select は不要です。それでも select できるポリシーが残っていると、
-- 本人ブラウザのJSが暗号文の access_token / refresh_token を読み出せます。
-- 列単位のGRANTに置き換えます（service_role は影響を受けません）。
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
--
-- Stripe は同じイベントを一度以上送信してきます（at-least-once）。
-- 同じイベントを二度処理すると、契約状態や返信状態が壊れることもあります。
begin;

create table if not exists public.stripe_events (
  id text primary key,
  created_at timestamptz not null default now()
);

-- service role 経由でのみアクセスするため、RLSを有効にしたままポリシーを付けない
alter table public.stripe_events enable row level security;

-- 遅れて届いた古いイベントで、新しい契約状態を上書きしないための時刻
alter table public.profiles
  add column if not exists stripe_event_created_at timestamptz;

commit;

-- ---------- 20261020120800_add_reply_source.sql ----------
-- 返信の「出所」を記録する posted_via 列を追加
--
-- `auto_replied` の boolean だけでは、AIが投稿した返信と、
-- 店主が Googleマップ上で直接書いた返信を区別できない。
-- NULL なら「取得で同期したもの（出所が分からない）」として扱う。
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

-- ---------- 20261021100000_add_stripe_event_processing.sql ----------
-- stripe_events に「処理済み時刻」と「試行回数」を追加
--
-- これまで webhook はイベントを処理する"前"に stripe_events へイベントIDを書いていたため、
-- 途中で失敗して 500 を返したイベントが Stripe の再送時に「重複」と判定され、
-- 200 で返って二度と処理されなかった（契約・解約の取りこぼし）。
--
-- processed_at が NULL のままなら「未処理」なので、再送で必ず処理し直される。
-- attempts は失敗のたびに増える再送回数で、運用で取りこぼしを可視化するために使う。
--
-- 前提:
-- - `stripe_events` は `20261020120700_create_stripe_events.sql` で作られるため、
--   マイグレーションはファイル名順に適用する（テーブルが無ければエラーになる）。
-- - `not null default 0` の追加は PostgreSQL 11 以降の高速パスを使い、
--   既存行の再書き込みは起こらない（Supabase は PostgreSQL 15 以降なので問題なし）。
-- - `alter table` は ACCESS EXCLUSIVE ロックを取るが、ここでの行数は
--   数百〜数千行程度なので待ち時間はミリ秒オーダー。
begin;

alter table public.stripe_events
  add column if not exists processed_at timestamptz;

alter table public.stripe_events
  add column if not exists attempts integer not null default 0;

-- 旧実装で記録済みの行は「処理済み」とみなす。
-- 未処理のまま残すと、古い checkout イベントが再送されたときに
-- 契約状態を巻き戻す（解約なのに active になる等）恐れがあるため。
-- このマイグレーションの基準時刻より前に記録された行だけを対象にして、
-- 新しい実装で処理中の行を誤って処理済みにしない。
--
-- 基準時刻は固定値（ファイル名のタイムスタンプ）にしてある。
-- 適用時刻（now()）にしてしまうと、あとから setup-all.sql を再実行しただけで
-- 新しい実装が処理し損ねた行まで「処理済み」扱いになってしまうため、固定値のほうが安全。
update public.stripe_events
set processed_at = created_at
where processed_at is null
  and created_at <= timestamptz '2026-10-21 10:00:00+00';

commit;

-- ---------- 20261021110000_add_auto_reply_attempts.sql ----------
-- 自動返信の試行回数を数える列を追加
--
-- AIの返信文が空文字・日本語でない文になるなど、そのレビュー固有の失敗が
-- 繰り返されると、そのレビューが「未返信」の先頭に残り、バッチの枠を
-- 他のレビューに回せません（poison pill）。
--
-- 試行回数を数えて上限（5回）に達したレビューは自動返信の対象から外し、
-- 他のレビューへ進ませます。Googleマップ上に既存の返信が見つかったとき
-- （店主がマップ上で直接返信したケース）や、返信の記録に成功したときは
-- 0 に戻します。
--
-- 未適用の環境でも自動返信自体は動きます（poison pill 対策のみが無効）。
--
-- 前提:
-- - `reviews` は `20261020120100_create_reviews.sql` で作られるため、
--   マイグレーションはファイル名順に適用する（テーブルが無ければエラーになる）。
-- - `not null default 0` の追加は PostgreSQL 11 以降の高速パスを使い、
--   既存行の再書き込みは起こらない（Supabase は PostgreSQL 15 以降なので問題なし）。
-- - インデックスは書き込みを止める SHARE ロックを短暂に取るが、
--   対象は数百〜数千行程度なので構築はミリ秒オーダー。
--   `create index concurrently` はトランザクション内（begin/commit）では
--   実行できないため、ここでは使わない。
begin;

alter table public.reviews
  add column if not exists auto_reply_attempts integer not null default 0;

-- 上限判定で対象を絞り込むためのインデックス
create index if not exists reviews_user_id_auto_reply_attempts_idx
  on public.reviews (user_id, auto_reply_attempts);

commit;

-- ---------- 20261021120000_add_claimed_by.sql ----------
-- 自動返信の排他制御に「確保した実行」を記録する `claimed_by` カラムを追加
--
-- `claimed_at` だけでは「誰が確保したか」が分からないため、
-- 解放条件は「一定時間以上前のもの目安」しかなく、
-- 実行中の処理が他の実行に確保を奪われてしまう。
--
-- `claimed_by` に実行固有のIDを入れておくと、解放処理で
-- 「自分が今回確保した行」を区別して除外できる。
--
-- 前提:
-- - `reviews` は `20261020120100_create_reviews.sql` で作られるため、
--   マイグレーションはファイル名順に適用する（テーブルが無ければエラーになる）。
-- - 排他制御の基準となる `claimed_at` は
--   `20261020120400_add_claim_and_preserve_reply.sql` で追加済み。
-- - 値を入れるのは自動返信の実行固有ID（16バイトのhex文字列）なので
--   長さの制限は不要。書き込まれない行もあるため NULL 許容にしてある。
begin;

alter table public.reviews
  add column if not exists claimed_by text;

commit;

-- ---------- 20261021130000_revoke_anon_gbp_connections.sql ----------
-- gbp_connections に対する anon ロールの select 権限を落とす
--
-- 20261020120600_limit_gbp_connections_grant.sql では
-- `revoke select on public.gbp_connections from authenticated;` としていますが、
-- anon ロールは取り残されていました。Supabase が public スキーマのテーブルに
-- 既定で与えるテーブル単位の select 権限が anon には残ったままです。
--
-- 現状は RLS（`gbp_connections_select_own` = auth.uid() = user_id のみ）が
-- 効いているので、anon が実際に1行も読み出すことはできません。
-- それでも不要な権限を残しておくと、あとからポリシーが緩んだときに
-- 暗号化された access_token / refresh_token を読まれる恐れがあるため、
-- ここで落としておきます（多層防御）。
--
-- このアプリは gbp_connections を service role クライアントでしか読み書きしません。
-- service_role は影響を受けません。REVOKE は既存のセッションを切断せず、
-- 以降のクエリから権限が反映されるだけです。
begin;

revoke select on public.gbp_connections from anon;

commit;

-- ============================================================
-- 実行結果の確認
-- ============================================================
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'profiles',
    'shop_settings',
    'reviews',
    'gbp_connections',
    'stripe_events'
  )
order by table_name, column_name;

-- 暗号化トークン列がブラウザから読められていないことの確認
-- （access_token / refresh_token が表示されなければ成功です）
select grantee, column_name
from information_schema.column_privileges
where table_schema = 'public'
  and table_name = 'gbp_connections'
  and grantee in ('authenticated', 'anon')
order by grantee, column_name;
