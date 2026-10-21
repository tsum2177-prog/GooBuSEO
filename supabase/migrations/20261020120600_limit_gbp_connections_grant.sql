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

-- 実行結果の確認: access_token / refresh_token が表示されなければ成功です。
select grantee, column_name
from information_schema.column_privileges
where table_schema = 'public'
  and table_name = 'gbp_connections'
  and grantee in ('authenticated', 'anon')
order by grantee, column_name;
