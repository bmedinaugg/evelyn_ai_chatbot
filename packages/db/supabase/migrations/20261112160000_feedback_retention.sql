-- M3b: answer feedback, retention (anonymise after 90 days, purge login codes and account
-- bindings after 24 hours) and deletion requests (DSAR) by email hash. Decisions: ARCHITECTURE §4.

-- Feedback ---------------------------------------------------------------------------------------
alter table public.flags drop constraint flags_reason_check;
alter table public.flags add constraint flags_reason_check check (
  reason in ('no_match', 'low_confidence', 'invalid_citation', 'needs_human', 'wants_human',
    'account_question', 'refusal', 'error', 'thumbs_down')
);

create table public.message_feedback (
  message_id bigint primary key references public.messages (id) on delete cascade,
  rating text not null check (rating in ('up', 'down')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Rates a visible assistant reply of this conversation; false for anything else (another
-- conversation's message, a customer message, a tool step). A first or changed "down" flags it.
create function public.record_feedback(p_conversation_id uuid, p_message_id bigint, p_rating text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_previous text;
begin
  if p_rating is null or p_rating not in ('up', 'down') then
    raise exception 'invalid rating' using errcode = '22023';
  end if;
  perform 1 from public.messages
  where id = p_message_id and conversation_id = p_conversation_id
    and role = 'assistant' and display_text <> '';
  if not found then
    return false;
  end if;

  select rating into v_previous from public.message_feedback where message_id = p_message_id for update;
  insert into public.message_feedback (message_id, rating)
  values (p_message_id, p_rating)
  on conflict (message_id) do update set rating = excluded.rating, updated_at = now();

  if p_rating = 'down' and v_previous is distinct from 'down'
     and not exists (select 1 from public.flags where message_id = p_message_id and reason = 'thumbs_down') then
    insert into public.flags (conversation_id, message_id, reason)
    values (p_conversation_id, p_message_id, 'thumbs_down');
  end if;
  return true;
end;
$$;

-- append_chat_turn now returns the assistant message id (null without a reply) for feedback.
drop function public.append_chat_turn(uuid, uuid, jsonb, jsonb, text[], jsonb);

create function public.append_chat_turn(
  p_conversation_id uuid,
  p_claim_id uuid,
  p_user jsonb,
  p_assistant jsonb,
  p_flags text[],
  p_steps jsonb default '[]'::jsonb
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_message_id bigint;
  v_assistant_id bigint;
  v_reason text;
  v_step jsonb;
begin
  perform 1 from public.conversations
  where id = p_conversation_id and turn_claim_id = p_claim_id
  for update;
  if not found then
    raise exception 'turn claim lost' using errcode = 'TM001';
  end if;
  -- A tool_use without its final answer would make the history unreplayable.
  if p_assistant is null and jsonb_array_length(coalesce(p_steps, '[]'::jsonb)) > 0 then
    raise exception 'tool steps need a final answer';
  end if;

  insert into public.messages (conversation_id, role, display_text, api_content, outcome, citations)
  values (
    p_conversation_id, 'user', p_user ->> 'display_text', p_user -> 'api_content',
    p_user ->> 'outcome', coalesce(p_user -> 'citations', '[]'::jsonb)
  )
  returning id into v_message_id;

  for v_step in select * from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb)) loop
    insert into public.messages (conversation_id, role, display_text, api_content)
    values (p_conversation_id, v_step ->> 'role', '', v_step -> 'api_content');
  end loop;

  if p_assistant is not null then
    insert into public.messages (conversation_id, role, display_text, api_content, outcome, citations)
    values (
      p_conversation_id, 'assistant', p_assistant ->> 'display_text', p_assistant -> 'api_content',
      p_assistant ->> 'outcome', coalesce(p_assistant -> 'citations', '[]'::jsonb)
    )
    returning id into v_assistant_id;
    v_message_id := v_assistant_id;
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
  return v_assistant_id;
end;
$$;

-- Retention --------------------------------------------------------------------------------------
alter table public.conversations add column anonymised_at timestamptz;
create index conversations_activity_idx
  on public.conversations ((coalesce(last_message_at, created_at)))
  where anonymised_at is null;
create index otp_challenges_created_idx on public.otp_challenges (created_at);

-- Removes what the customer typed and saw, API content (incl. tool data), the email hash, the
-- account binding and the token from conversations without activity since p_before. Keeps
-- outcomes, citations, flags, feedback, escalations, leads, club and status for reporting.
-- Batched (p_limit) and safe to run in parallel (skip locked); returns the number anonymised.
create function public.anonymise_conversations(p_before timestamptz, p_limit int)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(id), array[]::uuid[]) into v_ids from (
    select c.id from public.conversations c
    where c.anonymised_at is null and coalesce(c.last_message_at, c.created_at) < p_before
    order by coalesce(c.last_message_at, c.created_at)
    limit greatest(coalesce(p_limit, 0), 0)
    for update skip locked
  ) batch;

  update public.messages set display_text = '', api_content = '{}'::jsonb
  where conversation_id = any (v_ids);
  delete from public.otp_challenges where conversation_id = any (v_ids);
  update public.conversations
  set token_hash = 'anonymised:' || gen_random_uuid(),
      verified_email_hash = null,
      account_candidates = null,
      customer_id = null,
      turn_claim_id = null,
      turn_claimed_at = null,
      anonymised_at = now()
  where id = any (v_ids);
  return cardinality(v_ids);
end;
$$;

create function public.purge_otp_challenges(p_before timestamptz)
returns int
language sql
security invoker
set search_path = ''
as $$
  with deleted as (delete from public.otp_challenges where created_at < p_before returning 1)
  select count(*)::int from deleted;
$$;

-- Clears the customer id and account candidates of logins older than p_before. The verified email
-- hash stays (until anonymising) so a deletion request can still find the conversation.
create function public.clear_account_bindings(p_before timestamptz)
returns int
language sql
security invoker
set search_path = ''
as $$
  with cleared as (
    update public.conversations
    set customer_id = null, account_candidates = null
    where verified_at < p_before and (customer_id is not null or account_candidates is not null)
    returning 1
  )
  select count(*)::int from cleared;
$$;

-- Deletion request: removes the conversations verified with this email hash (messages, flags,
-- feedback and login codes cascade; escalations and leads keep a null link) and its login codes.
create function public.dsar_delete(p_email_hash text)
returns table (conversations int, otp_challenges int)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_conversations int;
  v_codes int;
begin
  if p_email_hash is null or length(p_email_hash) < 16 then
    raise exception 'invalid email hash' using errcode = '22023';
  end if;
  delete from public.otp_challenges o where o.email_hash = p_email_hash;
  get diagnostics v_codes = row_count;
  delete from public.conversations c where c.verified_email_hash = p_email_hash;
  get diagnostics v_conversations = row_count;
  return query select v_conversations, v_codes;
end;
$$;

-- Access: the server (service role) only.
revoke all on public.message_feedback from anon, authenticated;
grant select, insert, update, delete on public.message_feedback to service_role;
revoke execute on function public.record_feedback(uuid, bigint, text) from public, anon, authenticated;
revoke execute on function public.append_chat_turn(uuid, uuid, jsonb, jsonb, text[], jsonb) from public, anon, authenticated;
revoke execute on function public.anonymise_conversations(timestamptz, int) from public, anon, authenticated;
revoke execute on function public.purge_otp_challenges(timestamptz) from public, anon, authenticated;
revoke execute on function public.clear_account_bindings(timestamptz) from public, anon, authenticated;
revoke execute on function public.dsar_delete(text) from public, anon, authenticated;
grant execute on function public.record_feedback(uuid, bigint, text) to service_role;
grant execute on function public.append_chat_turn(uuid, uuid, jsonb, jsonb, text[], jsonb) to service_role;
grant execute on function public.anonymise_conversations(timestamptz, int) to service_role;
grant execute on function public.purge_otp_challenges(timestamptz) to service_role;
grant execute on function public.clear_account_bindings(timestamptz) to service_role;
grant execute on function public.dsar_delete(text) to service_role;
