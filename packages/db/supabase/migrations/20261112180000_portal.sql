-- M4a agent portal: sessions (Entra login), append-only audit log, review queries and audited
-- capability switches. Server (service role) only, like everything else.

create table public.portal_sessions (
  -- SHA-256 of the random session id held in the agent's httpOnly cookie; never the id itself.
  id_hash text primary key,
  user_oid text not null,          -- Entra object id of the agent
  display_name text not null,      -- shown in the portal and in audit rows (agents, not customers)
  roles text[] not null check (roles <@ array['agent', 'approver', 'admin']),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index portal_sessions_expires_idx on public.portal_sessions (expires_at);

-- audit_log exists since the baseline (actor, action, entity_type, entity_id, details, occurred_at).
-- Portal actors are Entra object ids in `actor`, with their display name next to it.
alter table public.audit_log add column actor_name text;
alter table public.audit_log add constraint audit_log_action_check
  check (action in ('capability.set', 'conversation.reveal', 'portal.login'));
create index audit_log_occurred_idx on public.audit_log (occurred_at desc);

-- Flagged conversations for review: newest flag first, reasons aggregated. Anonymised
-- conversations are left out (nothing left to review).
create function public.list_flagged_conversations(
  p_reason text,
  p_since timestamptz,
  p_limit int,
  p_offset int
)
returns table (
  conversation_id uuid,
  lang text,
  last_flag_at timestamptz,
  user_message_count int,
  reasons text[],
  escalated boolean,
  logged_in boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_reason is not null and p_reason not in ('no_match', 'low_confidence', 'invalid_citation',
      'needs_human', 'wants_human', 'account_question', 'refusal', 'error', 'thumbs_down') then
    raise exception 'unknown flag reason' using errcode = '22023';
  end if;

  return query
  select
    c.id,
    c.lang,
    max(f.created_at),
    c.user_message_count,
    array_agg(distinct f.reason order by f.reason),
    exists (select 1 from public.escalations e where e.conversation_id = c.id),
    c.verified_email_hash is not null
  from public.conversations c
  join public.flags f on f.conversation_id = c.id
  where c.anonymised_at is null
    and f.created_at >= p_since
    and (p_reason is null or exists (
      select 1 from public.flags f2 where f2.conversation_id = c.id and f2.reason = p_reason
    ))
  group by c.id
  order by max(f.created_at) desc, c.id
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- Switches an account capability and records who did it, atomically.
create function public.set_capability(
  p_name text,
  p_enabled boolean,
  p_actor_oid text,
  p_actor_name text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_name is null or p_name !~ '^[a-z][a-z_]{1,63}$' or p_enabled is null then
    raise exception 'invalid capability switch' using errcode = '22023';
  end if;
  insert into public.capability_flags (name, enabled, updated_at, updated_by)
  values (p_name, p_enabled, now(), p_actor_oid)
  on conflict (name) do update
    set enabled = excluded.enabled, updated_at = now(), updated_by = excluded.updated_by;
  insert into public.audit_log (actor, actor_name, action, entity_type, entity_id, details)
  values (p_actor_oid, p_actor_name, 'capability.set', 'capability', p_name,
    jsonb_build_object('enabled', p_enabled));
end;
$$;

-- Access: service role only; the audit log is append-only even for the server.
revoke all on public.portal_sessions from anon, authenticated;
revoke all on public.audit_log from anon, authenticated, service_role;
grant select, insert, delete on public.portal_sessions to service_role;
grant select, insert on public.audit_log to service_role;
revoke execute on function public.list_flagged_conversations(text, timestamptz, int, int) from public, anon, authenticated;
revoke execute on function public.set_capability(text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.list_flagged_conversations(text, timestamptz, int, int) to service_role;
grant execute on function public.set_capability(text, boolean, text, text) to service_role;
