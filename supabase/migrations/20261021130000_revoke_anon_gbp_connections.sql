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

-- 実行結果の確認: authenticated に渡した列だけが表示されれば成功です。
-- （access_token / refresh_token は表示されません）
select grantee, column_name
from information_schema.column_privileges
where table_schema = 'public'
  and table_name = 'gbp_connections'
  and grantee in ('authenticated', 'anon')
order by grantee, column_name;

-- 補足: anon にテーブル単位の select が残っていないことの確認
-- （0行なら成功です）
select privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'gbp_connections'
  and grantee = 'anon';
