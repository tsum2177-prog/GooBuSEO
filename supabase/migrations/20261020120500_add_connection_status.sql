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
