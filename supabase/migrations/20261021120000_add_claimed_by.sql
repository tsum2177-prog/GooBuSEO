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

-- 実行結果の確認: claimed_at と claimed_by が2行表示されれば成功です
-- （claimed_at は 20261020120400 で追加済み）
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'reviews'
  and column_name in ('claimed_at', 'claimed_by')
order by table_name, column_name;
