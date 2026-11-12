-- Hand-off to support (M3a): ticket topics synced daily from the Freshdesk ticket form, and a
-- record of created tickets (no personal data: the ticket in Freshdesk holds the contact details).

create table public.ticket_topics (
  value text primary key, -- the Freshdesk choice, sent as the ticket type
  active boolean not null default true,
  synced_at timestamptz not null default now()
);

create table public.escalations (
  id bigint generated always as identity primary key,
  conversation_id uuid references public.conversations (id) on delete set null,
  freshdesk_ticket_id bigint not null,
  topic text not null,
  reason text not null check (reason in ('customer_request', 'stuck')),
  created_at timestamptz not null default now()
);

create index escalations_created_idx on public.escalations (created_at);

-- Replaces the active topic list in one go; an empty list is refused (Freshdesk problem, not intent).
create or replace function public.replace_ticket_topics(p_values text[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(array_length(p_values, 1), 0) = 0 then
    raise exception 'refusing an empty topic list';
  end if;
  update public.ticket_topics set active = false where value <> all (p_values);
  insert into public.ticket_topics (value, active, synced_at)
  select distinct v, true, now() from unnest(p_values) as v
  on conflict (value) do update set active = true, synced_at = now();
end;
$$;

revoke execute on function public.replace_ticket_topics(text[]) from public, anon, authenticated;
grant execute on function public.replace_ticket_topics(text[]) to service_role;
