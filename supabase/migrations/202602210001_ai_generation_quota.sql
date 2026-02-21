create table if not exists public.ai_generation_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_name text not null default 'generate_workflow',
  created_at timestamptz not null default now()
);

create index if not exists ai_generation_events_user_created_idx
on public.ai_generation_events (user_id, created_at desc);

alter table public.ai_generation_events enable row level security;

create policy "ai_generation_events_select_own"
on public.ai_generation_events for select
to authenticated
using (auth.uid() = user_id);

create policy "ai_generation_events_insert_own"
on public.ai_generation_events for insert
to authenticated
with check (auth.uid() = user_id);
