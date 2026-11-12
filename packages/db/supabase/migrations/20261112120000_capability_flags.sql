-- Account tools can be switched off per environment (portal, M4). No row = enabled.
create table public.capability_flags (
  name text primary key,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text
);

comment on table public.capability_flags is 'Switch account tools on/off; changes are audited in audit_log (M4).';
