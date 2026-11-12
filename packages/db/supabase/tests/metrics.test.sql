begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

delete from public.conversations;
delete from public.daily_reports;

-- 2026-10-25 is the autumn DST change in Amsterdam: that day lasts 25 hours
-- (2026-10-24 22:00Z .. 2026-10-25 23:00Z).
insert into public.conversations (id, token_hash, lang, created_at, last_message_at, user_message_count, customer_status, anonymised_at) values
  -- resolved: last reply answered, no escalation, no thumbs down; 22:30Z = 00:30 on 25 Oct (CEST)
  ('00000000-0000-4000-8000-0000000000a1', 't1', 'nl', '2026-10-24 22:30Z', '2026-10-24 22:31Z', 1, 'MEMBER', null),
  -- answered, then thumbs down: not resolved
  ('00000000-0000-4000-8000-0000000000a2', 't2', 'en', '2026-10-25 12:00Z', '2026-10-25 12:01Z', 1, null, null),
  -- escalated: not resolved; created at 23:30Z = still 25 Oct in Amsterdam (UTC+1)
  ('00000000-0000-4000-8000-0000000000a3', 't3', 'nl', '2026-10-25 22:30Z', '2026-10-25 22:31Z', 2, null, null),
  -- anonymised but still counted (outcomes are kept)
  ('00000000-0000-4000-8000-0000000000a4', 't4', 'nl', '2026-10-25 08:00Z', '2026-10-25 08:01Z', 1, 'PROSPECT', '2026-10-26 00:00Z'),
  -- no customer message: not a conversation
  ('00000000-0000-4000-8000-0000000000a5', 't5', 'nl', '2026-10-25 09:00Z', null, 0, null, null),
  -- 26 Oct in Amsterdam (23:30Z on 25 Oct + 1h = 00:30): next day
  ('00000000-0000-4000-8000-0000000000a6', 't6', 'nl', '2026-10-25 23:30Z', '2026-10-25 23:31Z', 1, null, null);

insert into public.messages (conversation_id, role, display_text, api_content, outcome, created_at)
select * from (values
  ('00000000-0000-4000-8000-0000000000a1'::uuid, 'user', 'Hoe bevries ik?', '"q"'::jsonb, null, '2026-10-24 22:30Z'::timestamptz),
  ('00000000-0000-4000-8000-0000000000a1', 'assistant', 'Zo.', '[]', 'answered', '2026-10-24 22:31Z'),
  ('00000000-0000-4000-8000-0000000000a2', 'user', 'Opening hours mail me at jan@example.com', '"q"', null, '2026-10-25 12:00Z'),
  ('00000000-0000-4000-8000-0000000000a2', 'assistant', 'They are...', '[]', 'answered', '2026-10-25 12:01Z'),
  ('00000000-0000-4000-8000-0000000000a3', 'user', 'Mijn incasso klopt niet', '"q"', null, '2026-10-25 22:30Z'),
  ('00000000-0000-4000-8000-0000000000a3', 'assistant', 'Geen idee.', '[]', 'no_match', '2026-10-25 22:30Z'),
  ('00000000-0000-4000-8000-0000000000a3', 'user', 'Mijn incasso klopt niet!!', '"q"', null, '2026-10-25 22:31Z'),
  ('00000000-0000-4000-8000-0000000000a3', 'assistant', 'Ik zet je door.', '[]', 'handoff', '2026-10-25 22:31Z'),
  ('00000000-0000-4000-8000-0000000000a4', 'user', '', '{}', null, '2026-10-25 08:00Z'),
  ('00000000-0000-4000-8000-0000000000a4', 'assistant', '', '{}', 'no_match', '2026-10-25 08:01Z'),
  ('00000000-0000-4000-8000-0000000000a6', 'user', 'Sauna?', '"q"', null, '2026-10-25 23:30Z'),
  ('00000000-0000-4000-8000-0000000000a6', 'assistant', 'Ja.', '[]', 'answered', '2026-10-25 23:31Z')
) v;

create temp table m as
select m.id, m.conversation_id, m.role, m.display_text from public.messages m order by m.id;

insert into public.message_feedback (message_id, rating, created_at)
select id, 'up', '2026-10-24 22:40Z' from m where conversation_id = '00000000-0000-4000-8000-0000000000a1' and role = 'assistant';
insert into public.message_feedback (message_id, rating, created_at)
select id, 'down', '2026-10-25 12:05Z' from m where conversation_id = '00000000-0000-4000-8000-0000000000a2' and role = 'assistant';

insert into public.flags (conversation_id, message_id, reason, created_at)
select conversation_id, id, 'thumbs_down', '2026-10-25 12:05Z' from m where conversation_id = '00000000-0000-4000-8000-0000000000a2' and role = 'assistant';
-- Two flags on the same question, one on the next question of the same conversation.
insert into public.flags (conversation_id, message_id, reason, created_at)
select conversation_id, id, r, '2026-10-25 22:30Z' from m, unnest(array['no_match', 'low_confidence']) r
where conversation_id = '00000000-0000-4000-8000-0000000000a3' and display_text = 'Geen idee.';
insert into public.flags (conversation_id, message_id, reason, created_at)
select conversation_id, id, 'wants_human', '2026-10-25 22:31Z' from m
where conversation_id = '00000000-0000-4000-8000-0000000000a3' and display_text = 'Ik zet je door.';
insert into public.flags (conversation_id, message_id, reason, created_at)
select conversation_id, id, 'no_match', '2026-10-25 08:01Z' from m
where conversation_id = '00000000-0000-4000-8000-0000000000a4' and role = 'assistant';
insert into public.escalations (conversation_id, freshdesk_ticket_id, topic, reason, created_at)
values ('00000000-0000-4000-8000-0000000000a3', 1, 'Payments', 'stuck', '2026-10-25 22:32Z');

-- Daily metrics --------------------------------------------------------------------------------
select results_eq(
  $$select day, conversations, resolved, escalations, thumbs_up, thumbs_down, logins
    from public.daily_metrics('2026-10-24', '2026-10-26')$$,
  $$values ('2026-10-24'::date, 0, 0, 0, 0, 0, 0),
           ('2026-10-25'::date, 4, 1, 1, 1, 1, 2),
           ('2026-10-26'::date, 1, 1, 0, 0, 0, 0)$$,
  'one row per Amsterdam day, the 25-hour DST day included'
);
select is(
  (select flags from public.daily_metrics('2026-10-25', '2026-10-25')),
  '{"no_match": 2, "thumbs_down": 1, "wants_human": 1, "low_confidence": 1}'::jsonb,
  'flags per reason'
);
select is(
  (select flags from public.daily_metrics('2026-10-24', '2026-10-24')),
  '{}'::jsonb,
  'an empty day has no flags, not null'
);
select is(
  (select approved_answers from public.daily_metrics('2026-10-25', '2026-10-25')),
  0,
  'no approved answers used'
);
select throws_ok(
  $$select * from public.daily_metrics('2026-10-26', '2026-10-25')$$,
  '22023', null, 'from after to is rejected'
);
select throws_ok(
  $$select * from public.daily_metrics('2026-01-01', '2026-04-03')$$,
  '22023', null, 'more than 92 days is rejected'
);
select lives_ok(
  $$select * from public.daily_metrics('2026-01-01', '2026-04-02')$$,
  '92 days is allowed'
);

-- Flagged questions ----------------------------------------------------------------------------
select results_eq(
  $$select conversation_id::text, question, reasons
    from public.flagged_questions('2026-10-24 23:00Z', '2026-10-25 23:00Z', 100)$$,
  $$values ('00000000-0000-4000-8000-0000000000a2', 'Opening hours mail me at jan@example.com', array['thumbs_down']),
           ('00000000-0000-4000-8000-0000000000a3', 'Mijn incasso klopt niet', array['low_confidence', 'no_match']),
           ('00000000-0000-4000-8000-0000000000a3', 'Mijn incasso klopt niet!!', array['wants_human'])$$,
  'the customer question before each flagged reply, flags merged, anonymised ones skipped'
);
select is(
  (select count(*)::int from public.flagged_questions('2026-10-24 23:00Z', '2026-10-25 23:00Z', 1)),
  1, 'limit'
);
select results_eq(
  $$select question from public.flagged_questions('2026-10-24 23:00Z', '2026-10-25 23:00Z', 2, 1)$$,
  $$values ('Mijn incasso klopt niet'), ('Mijn incasso klopt niet!!')$$,
  'pages with an offset, in a stable order'
);
select is(
  (select count(*)::int from public.flagged_questions('2026-10-20 00:00Z', '2026-10-21 00:00Z', 100)),
  0, 'nothing outside the window'
);

-- Flagged list for one day ([since, until)) ---------------------------------------------------
select results_eq(
  $$select conversation_id::text from public.list_flagged_conversations(null, '2026-10-24 22:00Z', 50, 0, '2026-10-25 23:00Z')$$,
  $$values ('00000000-0000-4000-8000-0000000000a3'), ('00000000-0000-4000-8000-0000000000a2')$$,
  'flagged list limited to a day (anonymised left out)'
);
select is(
  (select count(*)::int from public.list_flagged_conversations(null, '2026-10-25 23:00Z', 50, 0, '2026-10-26 23:00Z')),
  0, 'nothing flagged the next day'
);

-- Daily reports: claim (token), finish, release, resend ---------------------------------------
create temp table claims (name text primary key, id uuid);
insert into claims values ('a', public.claim_daily_report('2026-10-25', false));
select isnt((select id from claims where name = 'a'), null, 'first claim wins and gets a token');
select is(public.claim_daily_report('2026-10-25', false), null, 'a parallel run does not claim the same day');
select ok(
  not public.finish_daily_report('2026-10-25', gen_random_uuid(), 3, true, '[]'::jsonb),
  'finishing needs the claim token'
);
select ok(
  public.finish_daily_report('2026-10-25', (select id from claims where name = 'a'), 3, true,
    '[{"labelNl": "Incasso", "labelEn": "Direct debit", "count": 2, "conversationIds": []}]'::jsonb),
  'finish records the send'
);
select results_eq(
  $$select recipients_count, clustered, jsonb_array_length(topics), sent_at is not null from public.daily_reports where day = '2026-10-25'$$,
  $$values (3, true, 1, true)$$,
  'report recorded'
);
select ok(
  not public.finish_daily_report('2026-10-25', (select id from claims where name = 'a'), 3, true, '[]'::jsonb),
  'a sent report is not finished twice'
);
select is(public.claim_daily_report('2026-10-25', false), null, 'a sent day is not sent again');
select isnt(public.claim_daily_report('2026-10-25', true), null, 'unless resending');

insert into claims values ('b', public.claim_daily_report('2026-10-26', false));
select lives_ok($$select public.release_daily_report('2026-10-26', gen_random_uuid())$$, 'release with a foreign token');
select is((select count(*)::int from public.daily_reports where day = '2026-10-26'), 1, 'does not remove someone else''s claim');
select lives_ok($$select public.release_daily_report('2026-10-26', (select id from claims where name = 'b'))$$, 'release after a failed send');
insert into claims values ('c', public.claim_daily_report('2026-10-26', false));
select isnt((select id from claims where name = 'c'), null, 'a released day can be claimed again');
update public.daily_reports set claimed_at = now() - interval '1 hour' where day = '2026-10-26';
insert into claims values ('d', public.claim_daily_report('2026-10-26', false));
select isnt((select id from claims where name = 'd'), null, 'a stale unsent claim (crashed run) can be taken over');
select ok(
  not public.finish_daily_report('2026-10-26', (select id from claims where name = 'c'), 1, false, '[]'::jsonb),
  'the run that lost its claim cannot finish'
);

-- Security -------------------------------------------------------------------------------------
select ok(
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'daily_reports')
    and not has_table_privilege('anon', 'public.daily_reports', 'select')
    and not has_function_privilege('anon', 'public.daily_metrics(date,date)', 'execute')
    and not has_function_privilege('anon', 'public.flagged_questions(timestamptz,timestamptz,int,int)', 'execute')
    and not has_function_privilege('anon', 'public.claim_daily_report(date,boolean)', 'execute')
    and not has_function_privilege('anon', 'private.enable_rls_on_create()', 'execute')
    and not has_function_privilege('anon', 'private.scenario_version_immutable()', 'execute'),
  'RLS on, nothing for anon, trigger functions tidied'
);

select * from finish();
rollback;
