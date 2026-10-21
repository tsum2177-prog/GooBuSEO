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

-- 実行結果の確認
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and table_name in ('profiles', 'stripe_events')
order by table_name, column_name;
