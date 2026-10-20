-- レビュー履歴（Googleマップから取得した口コミ）
begin;

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  location_id text,
  external_id text not null,
  author_name text,
  rating integer not null check (rating between 1 and 5),
  content text,
  published_at timestamptz,
  reply_text text,
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, external_id)
);

alter table public.reviews enable row level security;

drop policy if exists "reviews_select_own" on public.reviews;
create policy "reviews_select_own"
  on public.reviews
  for select
  using (auth.uid() = user_id);

create index if not exists reviews_user_id_published_at_idx
  on public.reviews (user_id, published_at desc);

commit;
