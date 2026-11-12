-- Anonymous widget conversations (M1b). Server-only; RLS from the baseline trigger, no grants to
-- anon/authenticated. History is append-only: assistant turns are stored verbatim (API content
-- blocks) and replayed unchanged.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null, -- sha256 of the bearer token held by the widget
  lang text not null check (lang in ('nl', 'en')),
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  user_message_count int not null default 0,
  turn_claimed_at timestamptz, -- one turn in flight; see claim_conversation_turn
  turn_claim_id uuid -- only the current claim holder may append or release
);

create table public.messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  created_at timestamptz not null default now(),
  display_text text not null,
  api_content jsonb not null,
  outcome text check (
    outcome in ('answered', 'declined', 'unsupported', 'handoff', 'no_match', 'invalid_citation',
      'refusal', 'error', 'limit')
  ),
  citations jsonb not null default '[]'::jsonb
);

create index messages_conversation_idx on public.messages (conversation_id, id);

create table public.flags (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  message_id bigint references public.messages (id) on delete cascade,
  reason text not null check (
    reason in ('no_match', 'low_confidence', 'invalid_citation', 'needs_human', 'wants_human',
      'account_question', 'refusal', 'error')
  ),
  created_at timestamptz not null default now()
);

create index flags_created_idx on public.flags (created_at);

-- No personal data: the ticket in Freshdesk holds the contact details.
create table public.lead_submissions (
  id bigint generated always as identity primary key,
  conversation_id uuid references public.conversations (id) on delete set null,
  freshdesk_ticket_id bigint not null,
  lang text not null check (lang in ('nl', 'en')),
  created_at timestamptz not null default now()
);

-- Claims the conversation for one turn and returns the claim id (null if another turn is in
-- flight). Claims older than 60 seconds count as abandoned and can be taken over; the previous
-- holder then can no longer append or release (its id no longer matches).
create or replace function public.claim_conversation_turn(p_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_claim_id uuid := gen_random_uuid();
begin
  update public.conversations
  set turn_claimed_at = now(), turn_claim_id = v_claim_id
  where id = p_id
    and (turn_claimed_at is null or turn_claimed_at < now() - interval '60 seconds');
  return case when found then v_claim_id else null end;
end;
$$;

create or replace function public.release_conversation_turn(p_id uuid, p_claim_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.conversations
  set turn_claimed_at = null, turn_claim_id = null
  where id = p_id and turn_claim_id = p_claim_id;
$$;

-- Appends the user message, the optional assistant message and the flags in one transaction,
-- then bumps the counters and releases the claim. Raises TM001 if the caller lost its claim.
create or replace function public.append_chat_turn(
  p_conversation_id uuid,
  p_claim_id uuid,
  p_user jsonb,
  p_assistant jsonb,
  p_flags text[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_message_id bigint;
  v_reason text;
begin
  perform 1 from public.conversations
  where id = p_conversation_id and turn_claim_id = p_claim_id
  for update;
  if not found then
    raise exception 'turn claim lost' using errcode = 'TM001';
  end if;

  insert into public.messages (conversation_id, role, display_text, api_content, outcome, citations)
  values (
    p_conversation_id, 'user', p_user ->> 'display_text', p_user -> 'api_content',
    p_user ->> 'outcome', coalesce(p_user -> 'citations', '[]'::jsonb)
  )
  returning id into v_message_id;

  if p_assistant is not null then
    insert into public.messages (conversation_id, role, display_text, api_content, outcome, citations)
    values (
      p_conversation_id, 'assistant', p_assistant ->> 'display_text', p_assistant -> 'api_content',
      p_assistant ->> 'outcome', coalesce(p_assistant -> 'citations', '[]'::jsonb)
    )
    returning id into v_message_id;
  end if;

  foreach v_reason in array coalesce(p_flags, array[]::text[]) loop
    insert into public.flags (conversation_id, message_id, reason)
    values (p_conversation_id, v_message_id, v_reason);
  end loop;

  update public.conversations
  set user_message_count = user_message_count + 1,
      last_message_at = now(),
      turn_claimed_at = null,
      turn_claim_id = null
  where id = p_conversation_id;
end;
$$;

revoke execute on function public.claim_conversation_turn(uuid) from public, anon, authenticated;
revoke execute on function public.release_conversation_turn(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.append_chat_turn(uuid, uuid, jsonb, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.claim_conversation_turn(uuid) to service_role;
grant execute on function public.release_conversation_turn(uuid, uuid) to service_role;
grant execute on function public.append_chat_turn(uuid, uuid, jsonb, jsonb, text[]) to service_role;
