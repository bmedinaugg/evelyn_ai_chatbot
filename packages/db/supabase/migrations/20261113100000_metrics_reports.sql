-- M5: daily metrics (computed live; anonymising keeps outcomes, flags, feedback and escalations),
-- the flagged questions for the daily report, and one daily_reports row per Amsterdam day so a
-- retried job never sends twice. Definitions: ARCHITECTURE §3.6.

-- Per Amsterdam calendar day (23 or 25 hours on DST days):
-- conversations  with at least one customer message, by creation day
-- resolved       of those: last bot reply 'answered', no escalation, no thumbs down
-- escalations, thumbs_up/down, flags (per reason): by their own creation day
-- approved_answers  bot replies that showed an approved answer
-- logins         conversations of that day where the customer picked an account
create function public.daily_metrics(p_from date, p_to date)
returns table (
  day date,
  conversations int,
  resolved int,
  escalations int,
  thumbs_up int,
  thumbs_down int,
  approved_answers int,
  logins int,
  flags jsonb
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 91 then
    raise exception 'invalid range (at most 92 days)' using errcode = '22023';
  end if;

  return query
  with days as (
    select d::date as day,
      (d::date::timestamp at time zone 'Europe/Amsterdam') as day_start,
      ((d::date + 1)::timestamp at time zone 'Europe/Amsterdam') as day_end
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
  )
  select
    days.day,
    (select count(*)::int from public.conversations c
      where c.created_at >= days.day_start and c.created_at < days.day_end
        and c.user_message_count > 0),
    (select count(*)::int from public.conversations c
      where c.created_at >= days.day_start and c.created_at < days.day_end
        and c.user_message_count > 0
        and (select m.outcome from public.messages m
             where m.conversation_id = c.id and m.role = 'assistant' and m.outcome is not null
             order by m.id desc limit 1) = 'answered'
        and not exists (select 1 from public.escalations e where e.conversation_id = c.id)
        and not exists (select 1 from public.flags f
                        where f.conversation_id = c.id and f.reason = 'thumbs_down')),
    (select count(*)::int from public.escalations e
      where e.created_at >= days.day_start and e.created_at < days.day_end),
    (select count(*)::int from public.message_feedback mf
      where mf.rating = 'up' and mf.created_at >= days.day_start and mf.created_at < days.day_end),
    (select count(*)::int from public.message_feedback mf
      where mf.rating = 'down' and mf.created_at >= days.day_start and mf.created_at < days.day_end),
    (select count(*)::int from public.messages m
      where m.scenario_version_id is not null
        and m.created_at >= days.day_start and m.created_at < days.day_end),
    (select count(*)::int from public.conversations c
      where c.created_at >= days.day_start and c.created_at < days.day_end
        and c.customer_status is not null),
    coalesce((select jsonb_object_agg(r.reason, r.n) from (
        select f.reason, count(*)::int as n from public.flags f
        where f.created_at >= days.day_start and f.created_at < days.day_end
        group by f.reason
      ) r), '{}'::jsonb)
  from days
  order by days.day;
end;
$$;

-- The customer question before each flagged bot reply in [p_from, p_to), one row per question
-- (its flags merged), oldest first. Anonymised conversations and flags without a reply are
-- skipped. The text is unmasked: the caller masks it before it leaves the server.
create function public.flagged_questions(p_from timestamptz, p_to timestamptz, p_limit int)
returns table (conversation_id uuid, message_id bigint, reasons text[], question text)
language sql
stable
security invoker
set search_path = ''
as $$
  select q.conversation_id, max(f.message_id), array_agg(distinct f.reason order by f.reason),
    q.display_text
  from public.flags f
  join public.conversations c on c.id = f.conversation_id and c.anonymised_at is null
  cross join lateral (
    select m.id, m.conversation_id, m.display_text from public.messages m
    where m.conversation_id = f.conversation_id and m.role = 'user' and m.id < f.message_id
    order by m.id desc limit 1
  ) q
  where f.message_id is not null and f.created_at >= p_from and f.created_at < p_to
    and q.display_text <> ''
  group by q.conversation_id, q.id, q.display_text
  order by min(f.created_at), q.id
  limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;

-- Flagged list: optional end of the window (the portal's "flagged on this day" link from the
-- report). Replaces the M4a function; p_until null keeps the old behaviour.
drop function public.list_flagged_conversations(text, timestamptz, int, int);
create function public.list_flagged_conversations(
  p_reason text,
  p_since timestamptz,
  p_limit int,
  p_offset int,
  p_until timestamptz default null
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
    and (p_until is null or f.created_at < p_until)
    and (p_reason is null or exists (
      select 1 from public.flags f2 where f2.conversation_id = c.id and f2.reason = p_reason
    ))
  group by c.id
  order by max(f.created_at) desc, c.id
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;
revoke execute on function public.list_flagged_conversations(text, timestamptz, int, int, timestamptz) from public, anon, authenticated;
grant execute on function public.list_flagged_conversations(text, timestamptz, int, int, timestamptz) to service_role;

-- Daily report runs --------------------------------------------------------------------------
-- topics: [{labelNl, labelEn, count, conversationIds}] — labels and ids only, no customer text.
create table public.daily_reports (
  day date primary key,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  recipients_count int,
  clustered boolean,
  topics jsonb not null default '[]'::jsonb check (jsonb_typeof(topics) = 'array')
);

-- True when this run may send the report for the day: nobody claimed it yet, an earlier run
-- crashed without sending (claim older than 15 minutes), or p_resend.
create function public.claim_daily_report(p_day date, p_resend boolean)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_claimed int;
begin
  insert into public.daily_reports (day) values (p_day) on conflict (day) do nothing;
  get diagnostics v_claimed = row_count;
  if v_claimed = 1 then
    return true;
  end if;

  update public.daily_reports
  set claimed_at = now(), sent_at = null
  where day = p_day
    and (coalesce(p_resend, false)
      or (sent_at is null and claimed_at < now() - interval '15 minutes'));
  get diagnostics v_claimed = row_count;
  return v_claimed = 1;
end;
$$;

create function public.finish_daily_report(
  p_day date,
  p_recipients_count int,
  p_clustered boolean,
  p_topics jsonb
)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.daily_reports
  set sent_at = now(), recipients_count = p_recipients_count, clustered = p_clustered,
      topics = p_topics
  where day = p_day;
$$;

-- A failed send gives the day back, so the next run can retry it straight away.
create function public.release_daily_report(p_day date)
returns void
language sql
security invoker
set search_path = ''
as $$
  delete from public.daily_reports where day = p_day and sent_at is null;
$$;

revoke all on public.daily_reports from anon, authenticated;
grant select, insert, update, delete on public.daily_reports to service_role;

revoke execute on function public.daily_metrics(date, date) from public, anon, authenticated;
revoke execute on function public.flagged_questions(timestamptz, timestamptz, int) from public, anon, authenticated;
revoke execute on function public.claim_daily_report(date, boolean) from public, anon, authenticated;
revoke execute on function public.finish_daily_report(date, int, boolean, jsonb) from public, anon, authenticated;
revoke execute on function public.release_daily_report(date) from public, anon, authenticated;
grant execute on function public.daily_metrics(date, date) to service_role;
grant execute on function public.flagged_questions(timestamptz, timestamptz, int) to service_role;
grant execute on function public.claim_daily_report(date, boolean) to service_role;
grant execute on function public.finish_daily_report(date, int, boolean, jsonb) to service_role;
grant execute on function public.release_daily_report(date) to service_role;

-- Tidy-up found on preprod: trigger functions need no execute grant for anyone (triggers run
-- regardless), so nobody keeps the default PUBLIC grant.
revoke execute on function private.enable_rls_on_create() from public, anon, authenticated;
revoke execute on function private.scenario_version_immutable() from public, anon, authenticated;
