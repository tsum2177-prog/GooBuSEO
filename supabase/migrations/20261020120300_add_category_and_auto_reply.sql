-- 店舗設定の拡張（業種・自動返信の有効/無効）と、返信の自動投稿フラグ
begin;

alter table public.shop_settings
  add column if not exists category text;

alter table public.shop_settings
  add column if not exists auto_reply_enabled boolean not null default false;

alter table public.reviews
  add column if not exists auto_replied boolean not null default false;

commit;
