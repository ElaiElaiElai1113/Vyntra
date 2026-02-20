-- Vyntra MVP schema and policies
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.workflows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  description text not null,
  prompt text not null,
  definition_json jsonb not null,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null,
  category text not null,
  definition_json jsonb not null,
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  status text not null check (status in ('success', 'failed')),
  input_json jsonb not null,
  output_json jsonb not null,
  steps jsonb not null,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists workflows_set_updated_at on public.workflows;
create trigger workflows_set_updated_at
before update on public.workflows
for each row execute procedure public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.workflows enable row level security;
alter table public.templates enable row level security;
alter table public.runs enable row level security;

-- profiles: user can read/update own profile
create policy "profiles_select_own"
on public.profiles for select
to authenticated
using (auth.uid() = id);

create policy "profiles_update_own"
on public.profiles for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- workflows: user can CRUD only own workflows
create policy "workflows_select_own"
on public.workflows for select
to authenticated
using (auth.uid() = user_id);

create policy "workflows_insert_own"
on public.workflows for insert
to authenticated
with check (auth.uid() = user_id);

create policy "workflows_update_own"
on public.workflows for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "workflows_delete_own"
on public.workflows for delete
to authenticated
using (auth.uid() = user_id);

-- runs: user can read own runs; insert own runs
create policy "runs_select_own"
on public.runs for select
to authenticated
using (auth.uid() = user_id);

create policy "runs_insert_own"
on public.runs for insert
to authenticated
with check (auth.uid() = user_id);

-- templates: read-only for all authenticated users
create policy "templates_read_authenticated"
on public.templates for select
to authenticated
using (true);

insert into public.templates (name, description, category, tags, definition_json)
values
(
  'Client Intake Processor',
  'Webhook intake payload -> summarize -> classify -> extract fields -> save result.',
  'intake',
  array['va', 'intake', 'webhook'],
  $$
  {
    "schema_version": "1.0",
    "workflow": {
      "id": "wf_client_intake",
      "name": "Client Intake Processor",
      "description": "Process and structure new client intake submissions.",
      "tags": ["va", "intake", "webhook"],
      "entry_node_id": "n1",
      "variables": {},
      "nodes": [
        {
          "id": "n1",
          "type": "trigger.webhook",
          "name": "Intake Webhook",
          "position": { "x": 80, "y": 120 },
          "inputs": [],
          "outputs": [{ "id": "out", "label": "Out", "schema": "JSON" }],
          "config": {
            "path": "/intake",
            "method": "POST",
            "secret_required": true,
            "sample_payload": { "client_name": "Acme", "message": "Need onboarding support" }
          },
          "ui": { "icon": "webhook", "color": "neutral" }
        },
        {
          "id": "n2",
          "type": "ai.summarize",
          "name": "Summarize Needs",
          "position": { "x": 320, "y": 120 },
          "inputs": [{ "id": "in", "label": "In", "schema": "JSON" }],
          "outputs": [{ "id": "out", "label": "Out", "schema": "JSON" }],
          "config": {
            "input_path": "$.input",
            "style": "concise",
            "bullets": true,
            "output_key": "summary",
            "instructions": "Summarize client needs and urgency."
          },
          "ui": { "icon": "sparkles", "color": "neutral" }
        },
        {
          "id": "n3",
          "type": "ai.classify",
          "name": "Classify Request",
          "position": { "x": 560, "y": 120 },
          "inputs": [{ "id": "in", "label": "In", "schema": "JSON" }],
          "outputs": [{ "id": "out", "label": "Out", "schema": "JSON" }],
          "config": {
            "input_path": "$.summary",
            "labels": ["admin", "marketing", "operations", "other"],
            "output_key": "category",
            "confidence_key": "category_confidence",
            "instructions": "Classify service category."
          },
          "ui": { "icon": "tag", "color": "neutral" }
        },
        {
          "id": "n4",
          "type": "ai.extract_fields",
          "name": "Extract Structured Fields",
          "position": { "x": 800, "y": 120 },
          "inputs": [{ "id": "in", "label": "In", "schema": "JSON" }],
          "outputs": [{ "id": "out", "label": "Out", "schema": "JSON" }],
          "config": {
            "input_path": "$.input",
            "fields": [
              { "key": "client_name", "type": "string", "required": true },
              { "key": "service_type", "type": "string", "required": true },
              { "key": "urgency", "type": "string", "required": false }
            ],
            "output_key": "structured",
            "instructions": "Extract key details from intake payload."
          },
          "ui": { "icon": "scan", "color": "neutral" }
        },
        {
          "id": "n5",
          "type": "output.db_save",
          "name": "Save Intake",
          "position": { "x": 1040, "y": 120 },
          "inputs": [{ "id": "in", "label": "In", "schema": "JSON" }],
          "outputs": [{ "id": "out", "label": "Out", "schema": "JSON" }],
          "config": {
            "table": "va_items",
            "mode": "insert",
            "mapping": {
              "payload": "$.input",
              "summary": "$.summary",
              "category": "$.category",
              "structured": "$.structured"
            }
          },
          "ui": { "icon": "database", "color": "neutral" }
        }
      ],
      "edges": [
        {
          "id": "e1",
          "source": { "node_id": "n1", "port_id": "out" },
          "target": { "node_id": "n2", "port_id": "in" },
          "label": null,
          "condition": null
        },
        {
          "id": "e2",
          "source": { "node_id": "n2", "port_id": "out" },
          "target": { "node_id": "n3", "port_id": "in" },
          "label": null,
          "condition": null
        },
        {
          "id": "e3",
          "source": { "node_id": "n3", "port_id": "out" },
          "target": { "node_id": "n4", "port_id": "in" },
          "label": null,
          "condition": null
        },
        {
          "id": "e4",
          "source": { "node_id": "n4", "port_id": "out" },
          "target": { "node_id": "n5", "port_id": "in" },
          "label": null,
          "condition": null
        }
      ]
    }
  }
  $$::jsonb
),
(
  'Lead Qualification',
  'Manual lead intake -> classify -> condition branch -> save and optional export.',
  'leads',
  array['va', 'leads', 'qualification'],
  $$
  {
    "schema_version": "1.0",
    "workflow": {
      "id": "wf_lead_qualification",
      "name": "Lead Qualification",
      "description": "Score and route leads for follow-up.",
      "tags": ["va", "leads"],
      "entry_node_id": "n1",
      "variables": {},
      "nodes": [
        {
          "id": "n1",
          "type": "trigger.manual",
          "name": "Manual Lead Input",
          "position": { "x": 80, "y": 260 },
          "inputs": [],
          "outputs": [{ "id": "out", "label": "Out", "schema": "JSON" }],
          "config": {
            "sample_input": {
              "lead_name": "Skyline Labs",
              "message": "Need VA support for outreach",
              "industry": "SaaS"
            }
          },
          "ui": { "icon": "play", "color": "neutral" }
        },
        {
          "id": "n2",
          "type": "ai.classify",
          "name": "Score Lead",
          "position": { "x": 320, "y": 260 },
          "inputs": [{ "id": "in", "label": "In", "schema": "JSON" }],
          "outputs": [{ "id": "out", "label": "Out", "schema": "JSON" }],
          "config": {
            "input_path": "$.input",
            "labels": ["high", "medium", "low"],
            "output_key": "lead_tier",
            "confidence_key": "lead_confidence",
            "instructions": "Classify lead quality from context."
          },
          "ui": { "icon": "gauge", "color": "neutral" }
        },
        {
          "id": "n3",
          "type": "logic.condition",
          "name": "Priority Branch",
          "position": { "x": 560, "y": 260 },
          "inputs": [{ "id": "in", "label": "In", "schema": "JSON" }],
          "outputs": [
            { "id": "priority", "label": "Priority", "schema": "JSON" },
            { "id": "standard", "label": "Standard", "schema": "JSON" }
          ],
          "config": {
            "expression": "$.lead_tier == 'high'",
            "default_output": "standard"
          },
          "ui": { "icon": "split", "color": "neutral" }
        },
        {
          "id": "n4",
          "type": "output.db_save",
          "name": "Save Lead",
          "position": { "x": 800, "y": 220 },
          "inputs": [{ "id": "in", "label": "In", "schema": "JSON" }],
          "outputs": [{ "id": "out", "label": "Out", "schema": "JSON" }],
          "config": {
            "table": "va_items",
            "mode": "insert",
            "mapping": {
              "lead": "$.input",
              "tier": "$.lead_tier",
              "confidence": "$.lead_confidence"
            }
          },
          "ui": { "icon": "database", "color": "neutral" }
        },
        {
          "id": "n5",
          "type": "output.export",
          "name": "Export Priority Leads",
          "position": { "x": 800, "y": 340 },
          "inputs": [{ "id": "in", "label": "In", "schema": "JSON" }],
          "outputs": [{ "id": "out", "label": "Out", "schema": "JSON" }],
          "config": {
            "format": "csv",
            "input_path": "$.input",
            "filename": "priority-leads.csv"
          },
          "ui": { "icon": "download", "color": "neutral" }
        }
      ],
      "edges": [
        {
          "id": "e1",
          "source": { "node_id": "n1", "port_id": "out" },
          "target": { "node_id": "n2", "port_id": "in" },
          "label": null,
          "condition": null
        },
        {
          "id": "e2",
          "source": { "node_id": "n2", "port_id": "out" },
          "target": { "node_id": "n3", "port_id": "in" },
          "label": null,
          "condition": null
        },
        {
          "id": "e3",
          "source": { "node_id": "n3", "port_id": "priority" },
          "target": { "node_id": "n5", "port_id": "in" },
          "label": "high",
          "condition": "high"
        },
        {
          "id": "e4",
          "source": { "node_id": "n3", "port_id": "standard" },
          "target": { "node_id": "n4", "port_id": "in" },
          "label": "default",
          "condition": null
        }
      ]
    }
  }
  $$::jsonb
),
(
  'Meeting Notes to Tasks',
  'Upload notes -> extract action items -> generate checklist SOP -> export markdown/json.',
  'reports',
  array['va', 'notes', 'tasks'],
  $$
  {
    "schema_version": "1.0",
    "workflow": {
      "id": "wf_meeting_notes",
      "name": "Meeting Notes to Tasks",
      "description": "Convert uploaded notes into structured tasks and checklist report.",
      "tags": ["va", "notes", "tasks"],
      "entry_node_id": "n1",
      "variables": {},
      "nodes": [
        {
          "id": "n1",
          "type": "trigger.file_upload",
          "name": "Upload Meeting Notes",
          "position": { "x": 80, "y": 420 },
          "inputs": [],
          "outputs": [{ "id": "out", "label": "Out", "schema": "JSON" }],
          "config": {
            "accepted_types": ["text/plain", "application/pdf"],
            "max_size_mb": 10,
            "purpose": "meeting-notes"
          },
          "ui": { "icon": "upload", "color": "neutral" }
        },
        {
          "id": "n2",
          "type": "ai.extract_fields",
          "name": "Extract Action Items",
          "position": { "x": 320, "y": 420 },
          "inputs": [{ "id": "in", "label": "In", "schema": "JSON" }],
          "outputs": [{ "id": "out", "label": "Out", "schema": "JSON" }],
          "config": {
            "input_path": "$.input",
            "fields": [
              { "key": "action_items", "type": "array", "required": true },
              { "key": "owners", "type": "array", "required": false },
              { "key": "priorities", "type": "array", "required": false }
            ],
            "output_key": "tasks",
            "instructions": "Extract tasks with owner and priority if present."
          },
          "ui": { "icon": "list", "color": "neutral" }
        },
        {
          "id": "n3",
          "type": "ai.generate_report",
          "name": "Generate SOP Checklist",
          "position": { "x": 560, "y": 420 },
          "inputs": [{ "id": "in", "label": "In", "schema": "JSON" }],
          "outputs": [{ "id": "out", "label": "Out", "schema": "JSON" }],
          "config": {
            "template": "Checklist Report",
            "input_path": "$.tasks",
            "format": "markdown",
            "output_key": "sop_report",
            "instructions": "Generate a concise SOP checklist from extracted tasks."
          },
          "ui": { "icon": "file-text", "color": "neutral" }
        },
        {
          "id": "n4",
          "type": "output.export",
          "name": "Export Tasks",
          "position": { "x": 800, "y": 420 },
          "inputs": [{ "id": "in", "label": "In", "schema": "JSON" }],
          "outputs": [{ "id": "out", "label": "Out", "schema": "JSON" }],
          "config": {
            "format": "json",
            "input_path": "$.sop_report",
            "filename": "meeting-tasks.json"
          },
          "ui": { "icon": "download", "color": "neutral" }
        }
      ],
      "edges": [
        {
          "id": "e1",
          "source": { "node_id": "n1", "port_id": "out" },
          "target": { "node_id": "n2", "port_id": "in" },
          "label": null,
          "condition": null
        },
        {
          "id": "e2",
          "source": { "node_id": "n2", "port_id": "out" },
          "target": { "node_id": "n3", "port_id": "in" },
          "label": null,
          "condition": null
        },
        {
          "id": "e3",
          "source": { "node_id": "n3", "port_id": "out" },
          "target": { "node_id": "n4", "port_id": "in" },
          "label": null,
          "condition": null
        }
      ]
    }
  }
  $$::jsonb
)
on conflict do nothing;
