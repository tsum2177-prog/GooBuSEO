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

-- 実行結果の確認: processed_at と attempts が表示されれば成功です
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'stripe_events'
order by table_name, column_name;

-- 未処理のまま残っている行の件数（再送待ちのイベント）
select count(*) as unprocessed_events
from public.stripe_events
where processed_at is null;
