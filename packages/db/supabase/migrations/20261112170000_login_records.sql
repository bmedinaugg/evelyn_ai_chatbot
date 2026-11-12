-- M3b review fixes:
-- 1. Clearing account bindings after 24 hours also ends the verification: before, a still-open
--    tab could look the account up and bind it again without a new code.
-- 2. Every email that logged in to a conversation is remembered (conversation_logins), so a
--    deletion request also finds conversations where someone else logged in later (shared devices).

create table public.conversation_logins (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  email_hash text not null,
  verified_at timestamptz not null default now(),
  primary key (conversation_id, email_hash)
);
create index conversation_logins_email_idx on public.conversation_logins (email_hash);

-- Earlier logins: the current verified email of each conversation.
insert into public.conversation_logins (conversation_id, email_hash, verified_at)
select id, verified_email_hash, coalesce(verified_at, now())
from public.conversations
where verified_email_hash is not null and anonymised_at is null
on conflict do nothing;

create or replace function public.verify_otp_attempt(
  p_challenge_id uuid,
  p_conversation_id uuid,
  p_code_hash text,
  p_max_attempts int
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v public.otp_challenges%rowtype;
begin
  select * into v from public.otp_challenges
  where id = p_challenge_id and conversation_id = p_conversation_id
  for update;

  if not found or v.consumed_at is not null then
    return 'not_found';
  end if;
  if v.expires_at < now() then
    return 'expired';
  end if;
  if v.attempts >= p_max_attempts then
    return 'locked';
  end if;

  if v.code_hash = p_code_hash then
    update public.otp_challenges set consumed_at = now() where id = v.id;
    -- A new login replaces any earlier one in this conversation (shared devices): drop the
    -- previous candidates and account binding.
    update public.conversations
    set verified_email_hash = v.email_hash,
        verified_at = now(),
        account_candidates = null,
        customer_id = null,
        studio_id = null,
        customer_status = null
    where id = p_conversation_id;
    insert into public.conversation_logins (conversation_id, email_hash)
    values (p_conversation_id, v.email_hash)
    on conflict (conversation_id, email_hash) do update set verified_at = now();
    return 'ok';
  end if;

  update public.otp_challenges set attempts = attempts + 1 where id = v.id;
  return case when v.attempts + 1 >= p_max_attempts then 'locked' else 'invalid' end;
end;
$$;

-- Also ends the verification (verified_at); the email hash stays for deletion requests.
create or replace function public.clear_account_bindings(p_before timestamptz)
returns int
language sql
security invoker
set search_path = ''
as $$
  with cleared as (
    update public.conversations
    set customer_id = null, account_candidates = null, verified_at = null
    where verified_at < p_before
    returning 1
  )
  select count(*)::int from cleared;
$$;

create or replace function public.dsar_delete(p_email_hash text)
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
  delete from public.conversations c
  where c.verified_email_hash = p_email_hash
     or c.id in (select l.conversation_id from public.conversation_logins l where l.email_hash = p_email_hash);
  get diagnostics v_conversations = row_count;
  return query select v_conversations, v_codes;
end;
$$;

-- Anonymising also removes the login records (email hashes) of the conversations it touches.
create or replace function public.anonymise_conversations(p_before timestamptz, p_limit int)
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
  delete from public.conversation_logins where conversation_id = any (v_ids);
  update public.conversations
  set token_hash = 'anonymised:' || gen_random_uuid(),
      verified_email_hash = null,
      verified_at = null,
      account_candidates = null,
      customer_id = null,
      turn_claim_id = null,
      turn_claimed_at = null,
      anonymised_at = now()
  where id = any (v_ids);
  return cardinality(v_ids);
end;
$$;

revoke all on public.conversation_logins from anon, authenticated;
grant select, insert, update, delete on public.conversation_logins to service_role;
