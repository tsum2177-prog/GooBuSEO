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

-- 実行結果の確認: auto_reply_attempts が表示されれば成功です
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'reviews'
  and column_name = 'auto_reply_attempts';

-- 試行回数が上限に達して自動返信の対象から外れているレビューの件数
select count(*) as exhausted_reviews
from public.reviews
where reply_text is null
  and auto_reply_attempts >= 5;

-- 手動で再試行させる方法（AIの不具合を直したときなど）。
-- 下のSQLをSupabaseのSQL Editorで実行してください。
--
-- update public.reviews
--    set auto_reply_attempts = 0
--  where user_id = '<ユーザーID>'
--    and reply_text is null;
