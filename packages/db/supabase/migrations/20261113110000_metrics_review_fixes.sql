-- M5 review fixes: a failed resend no longer erases the earlier report record, and indexes for the
-- created_at ranges that daily_metrics and flagged_questions read.

-- Daily reports: keep the earlier send while a resend is in flight -----------------------------
-- A resend claim clears sent_at (so the claim semantics stay as they were) but first copies the
-- earlier send here. finish drops the copy; release puts it back instead of deleting the row.
alter table public.daily_reports
  add column previous_send jsonb
    check (previous_send is null or jsonb_typeof(previous_send) = 'object');

create or replace function public.claim_daily_report(p_day date, p_resend boolean)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_claim uuid := gen_random_uuid();
  v_count int;
begin
  insert into public.daily_reports (day, claim_id) values (p_day, v_claim)
  on conflict (day) do nothing;
  get diagnostics v_count = row_count;
  if v_count = 1 then
    return v_claim;
  end if;

  -- The right-hand sides read the row as it was before this update.
  update public.daily_reports
  set claim_id = v_claim, claimed_at = now(), sent_at = null,
      previous_send = case
        when sent_at is not null then jsonb_build_object(
          'sent_at', sent_at, 'recipients_count', recipients_count, 'clustered', clustered,
          'topics', topics)
        else previous_send
      end
  where day = p_day
    and (coalesce(p_resend, false)
      or (sent_at is null and claimed_at < now() - interval '15 minutes'));
  get diagnostics v_count = row_count;
  return case when v_count = 1 then v_claim end;
end;
$$;

create or replace function public.finish_daily_report(
  p_day date,
  p_claim_id uuid,
  p_recipients_count int,
  p_clustered boolean,
  p_topics jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count int;
begin
  update public.daily_reports
  set sent_at = now(), recipients_count = p_recipients_count, clustered = p_clustered,
      topics = p_topics, previous_send = null
  where day = p_day and claim_id = p_claim_id and sent_at is null;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

-- A failed send gives the day back (claim holder only): an earlier send is restored, a day that
-- was never sent is deleted so the next run can retry straight away.
create or replace function public.release_daily_report(p_day date, p_claim_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.daily_reports
  set sent_at = (previous_send ->> 'sent_at')::timestamptz,
      recipients_count = (previous_send ->> 'recipients_count')::int,
      clustered = (previous_send ->> 'clustered')::boolean,
      topics = previous_send -> 'topics',
      previous_send = null
  where day = p_day and claim_id = p_claim_id and sent_at is null and previous_send is not null;

  delete from public.daily_reports
  where day = p_day and claim_id = p_claim_id and sent_at is null and previous_send is null;
end;
$$;

-- create or replace keeps the M5 grants (service_role only); restated so this file stands alone.
revoke execute on function public.claim_daily_report(date, boolean) from public, anon, authenticated;
revoke execute on function public.finish_daily_report(date, uuid, int, boolean, jsonb) from public, anon, authenticated;
revoke execute on function public.release_daily_report(date, uuid) from public, anon, authenticated;
grant execute on function public.claim_daily_report(date, boolean) to service_role;
grant execute on function public.finish_daily_report(date, uuid, int, boolean, jsonb) to service_role;
grant execute on function public.release_daily_report(date, uuid) to service_role;

-- Indexes for the metrics' created_at ranges ----------------------------------------------------
-- escalations_created_idx and flags_created_idx exist already.
create index conversations_created_idx on public.conversations (created_at);
create index message_feedback_created_idx on public.message_feedback (created_at);
create index messages_approved_created_idx on public.messages (created_at)
  where scenario_version_id is not null;
