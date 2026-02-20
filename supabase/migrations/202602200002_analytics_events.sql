create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_name text not null,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.analytics_events enable row level security;

create policy "analytics_select_own"
on public.analytics_events for select
to authenticated
using (auth.uid() = user_id);

create policy "analytics_insert_own"
on public.analytics_events for insert
to authenticated
with check (auth.uid() = user_id);
