-- Customer login with an emailed one-time code (M2a). Email addresses and codes are stored only as
-- HMAC hashes computed by the server. Server-only (service_role); RLS from the baseline trigger.

create table public.otp_challenges (
  id uuid primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  email_hash text not null,
  code_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts int not null default 0,
  consumed_at timestamptz
);

create index otp_challenges_email_idx on public.otp_challenges (email_hash, created_at);

alter table public.conversations
  add column verified_email_hash text,
  add column verified_at timestamptz,
  -- [{customerId, studioId, status, studioName, maskedNumber}]; the client only ever sends an index.
  add column account_candidates jsonb,
  add column customer_id bigint,
  add column studio_id bigint,
  add column customer_status text check (customer_status in ('MEMBER', 'PROSPECT', 'FORMER_MEMBER'));

-- Creates a challenge unless the email is over a limit:
--   p_max_per_window challenges in the short window (3 per 15 min),
--   10 challenges or 15 failed attempts in the last 24 hours (stops slow, long-running guessing).
-- An advisory lock per email hash makes count-then-insert safe under parallel requests.
create or replace function public.create_otp_challenge(
  p_id uuid,
  p_conversation_id uuid,
  p_email_hash text,
  p_code_hash text,
  p_ttl_seconds int,
  p_max_per_window int,
  p_window_seconds int
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('otp:' || p_email_hash));

  if (
    select count(*) from public.otp_challenges
    where email_hash = p_email_hash
      and created_at > now() - make_interval(secs => p_window_seconds)
  ) >= p_max_per_window then
    return false;
  end if;

  if exists (
    select 1 from public.otp_challenges
    where email_hash = p_email_hash and created_at > now() - interval '24 hours'
    having count(*) >= 10 or coalesce(sum(attempts), 0) >= 15
  ) then
    return false;
  end if;

  insert into public.otp_challenges (id, conversation_id, email_hash, code_hash, expires_at)
  values (p_id, p_conversation_id, p_email_hash, p_code_hash, now() + make_interval(secs => p_ttl_seconds));
  return true;
end;
$$;

-- Checks one attempt atomically. Returns 'ok' | 'invalid' | 'locked' | 'expired' | 'not_found'.
-- On 'ok' the code is consumed and the conversation is marked verified for that email hash.
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
    return 'ok';
  end if;

  update public.otp_challenges set attempts = attempts + 1 where id = v.id;
  return case when v.attempts + 1 >= p_max_attempts then 'locked' else 'invalid' end;
end;
$$;

-- Stores the accounts found for the verified email (no personal data beyond ids and studio name).
create or replace function public.set_account_candidates(p_conversation_id uuid, p_candidates jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.conversations
  set account_candidates = p_candidates
  where id = p_conversation_id and verified_at is not null and customer_id is null;
$$;

-- Binds the candidate at p_index. Only after verification, only once, only a stored candidate.
create or replace function public.bind_account(p_conversation_id uuid, p_index int)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_candidate jsonb;
begin
  select account_candidates -> p_index into v_candidate
  from public.conversations
  where id = p_conversation_id
    and verified_at is not null
    and customer_id is null
    and p_index >= 0
  for update;

  if v_candidate is null then
    return false;
  end if;

  update public.conversations
  set customer_id = (v_candidate ->> 'customerId')::bigint,
      studio_id = (v_candidate ->> 'studioId')::bigint,
      customer_status = v_candidate ->> 'status'
  where id = p_conversation_id;
  return true;
end;
$$;

revoke execute on function public.create_otp_challenge(uuid, uuid, text, text, int, int, int) from public, anon, authenticated;
revoke execute on function public.verify_otp_attempt(uuid, uuid, text, int) from public, anon, authenticated;
revoke execute on function public.set_account_candidates(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.bind_account(uuid, int) from public, anon, authenticated;
grant execute on function public.create_otp_challenge(uuid, uuid, text, text, int, int, int) to service_role;
grant execute on function public.verify_otp_attempt(uuid, uuid, text, int) to service_role;
grant execute on function public.set_account_candidates(uuid, jsonb) to service_role;
grant execute on function public.bind_account(uuid, int) to service_role;
