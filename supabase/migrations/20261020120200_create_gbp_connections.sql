-- Google Business Profile連携（OAuthトークンの保存先）
create table if not exists public.gbp_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  google_account_id text not null,
  google_account_name text,
  location_id text not null,
  location_title text,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, location_id)
);

alter table public.gbp_connections enable row level security;

create policy "gbp_connections_select_own"
  on public.gbp_connections
  for select
  using (auth.uid() = user_id);

create policy "gbp_connections_delete_own"
  on public.gbp_connections
  for delete
  using (auth.uid() = user_id);

drop trigger if exists gbp_connections_set_updated_at on public.gbp_connections;
create trigger gbp_connections_set_updated_at
  before update on public.gbp_connections
  for each row
  execute function public.set_updated_at();
