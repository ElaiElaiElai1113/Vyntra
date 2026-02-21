create table if not exists public.va_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  source_node_id text,
  data_json jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.workflow_exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  source_node_id text,
  format text not null check (format in ('json', 'csv')),
  filename text not null,
  content_text text not null,
  payload_json jsonb,
  created_at timestamptz not null default now()
);

alter table public.va_items enable row level security;
alter table public.workflow_exports enable row level security;

create policy "va_items_select_own"
on public.va_items for select
to authenticated
using (auth.uid() = user_id);

create policy "va_items_insert_own"
on public.va_items for insert
to authenticated
with check (auth.uid() = user_id);

create policy "workflow_exports_select_own"
on public.workflow_exports for select
to authenticated
using (auth.uid() = user_id);

create policy "workflow_exports_insert_own"
on public.workflow_exports for insert
to authenticated
with check (auth.uid() = user_id);
