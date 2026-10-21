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

-- 実行結果の確認
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and table_name in ('profiles', 'stripe_events', 'reviews', 'gbp_connections')
order by table_name, column_name;
