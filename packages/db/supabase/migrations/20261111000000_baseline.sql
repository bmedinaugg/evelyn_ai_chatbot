-- Baseline: pgvector, private helper schema, deny-by-default access for the public API roles,
-- automatic Row Level Security on every new public table, and the audit log.
-- The widget never talks to Supabase; only the server (service_role) reads and writes.

create extension if not exists vector with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Deny by default: Supabase grants anon/authenticated access to new public objects.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;

-- Enable RLS on every table created in schema public, so a forgotten policy fails closed.
create or replace function private.enable_rls_on_create()
returns event_trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  obj record;
begin
  for obj in
    select * from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type = 'table'
      and schema_name = 'public'
  loop
    execute format('alter table %s enable row level security', obj.object_identity);
  end loop;
end;
$$;

create event trigger enable_rls_on_create
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function private.enable_rls_on_create();

create table public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor text not null,
  action text not null,
  entity_type text,
  entity_id text,
  details jsonb not null default '{}'
);

comment on table public.audit_log is
  'Who did what, when (portal approvals, capability toggles, publishes). Server-only.';
