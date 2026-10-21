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
