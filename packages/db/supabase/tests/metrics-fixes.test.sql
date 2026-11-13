begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

delete from public.daily_reports;

create temp table claims (name text primary key, id uuid);

-- A failed resend restores the earlier report record ------------------------------------------
insert into claims values ('sent', public.claim_daily_report('2026-10-25', false));
select ok(
  public.finish_daily_report('2026-10-25', (select id from claims where name = 'sent'), 3, true,
    '[{"labelNl": "Incasso", "labelEn": "Direct debit", "count": 2, "conversationIds": []}]'::jsonb),
  'first send recorded'
);
create temp table first_send as select sent_at from public.daily_reports where day = '2026-10-25';

insert into claims values ('resend', public.claim_daily_report('2026-10-25', true));
select isnt((select id from claims where name = 'resend'), null, 'resend claims the sent day');
select is(
  (select sent_at from public.daily_reports where day = '2026-10-25'), null,
  'while resending the day counts as unsent'
);
select lives_ok(
  $$select public.release_daily_report('2026-10-25', gen_random_uuid())$$,
  'release with a foreign token'
);
select is(
  (select sent_at from public.daily_reports where day = '2026-10-25'), null,
  'a foreign token restores nothing'
);
select lives_ok(
  $$select public.release_daily_report('2026-10-25', (select id from claims where name = 'resend'))$$,
  'the failed resend is released'
);
select results_eq(
  $$select sent_at, recipients_count, clustered, topics -> 0 ->> 'labelEn'
    from public.daily_reports where day = '2026-10-25'$$,
  $$select sent_at, 3, true, 'Direct debit' from first_send$$,
  'the earlier report record is restored'
);
select is(public.claim_daily_report('2026-10-25', false), null, 'the restored day is not sent again');

-- A crashed resend taken over, then released, still restores the record -------------------------
insert into claims values ('resend2', public.claim_daily_report('2026-10-25', true));
update public.daily_reports set claimed_at = now() - interval '1 hour' where day = '2026-10-25';
insert into claims values ('takeover', public.claim_daily_report('2026-10-25', false));
select isnt((select id from claims where name = 'takeover'), null, 'a stale resend claim can be taken over');
select lives_ok(
  $$select public.release_daily_report('2026-10-25', (select id from claims where name = 'takeover'))$$,
  'the takeover fails and releases'
);
select is(
  (select sent_at from public.daily_reports where day = '2026-10-25'),
  (select sent_at from first_send),
  'the earlier record survives a crashed resend and a failed takeover'
);

-- A successful resend replaces the record ------------------------------------------------------
insert into claims values ('resend3', public.claim_daily_report('2026-10-25', true));
select ok(
  public.finish_daily_report('2026-10-25', (select id from claims where name = 'resend3'), 5, false, '[]'::jsonb),
  'the resend is recorded'
);
select lives_ok(
  $$select public.release_daily_report('2026-10-25', (select id from claims where name = 'resend3'))$$,
  'a late release after the send'
);
select results_eq(
  $$select recipients_count, clustered, jsonb_array_length(topics) from public.daily_reports where day = '2026-10-25'$$,
  $$values (5, false, 0)$$,
  'the new send stands; nothing older comes back'
);

-- A first-time claim that fails still leaves nothing behind ------------------------------------
insert into claims values ('first', public.claim_daily_report('2026-10-27', false));
select public.release_daily_report('2026-10-27', (select id from claims where name = 'first'));
select is(
  (select count(*)::int from public.daily_reports where day = '2026-10-27'), 0,
  'releasing a never-sent day deletes its row'
);

-- Indexes for the metrics' created_at ranges --------------------------------------------------
select has_index('public', 'conversations', 'conversations_created_idx', array['created_at'], 'conversations by creation time');
select has_index('public', 'escalations', 'escalations_created_idx', array['created_at'], 'escalations by creation time');
select has_index('public', 'message_feedback', 'message_feedback_created_idx', array['created_at'], 'feedback by creation time');
select has_index('public', 'flags', 'flags_created_idx', array['created_at'], 'flags by creation time');
select ok(
  (select indexdef like '%(created_at) WHERE (scenario_version_id IS NOT NULL)'
   from pg_indexes where schemaname = 'public' and indexname = 'messages_approved_created_idx'),
  'approved answers by creation time (partial index)'
);

select ok(
  not has_function_privilege('anon', 'public.claim_daily_report(date,boolean)', 'execute')
    and not has_function_privilege('authenticated', 'public.finish_daily_report(date,uuid,int,boolean,jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.release_daily_report(date,uuid)', 'execute')
    and has_function_privilege('service_role', 'public.release_daily_report(date,uuid)', 'execute'),
  'replaced report functions stay service_role only'
);

select * from finish();
rollback;
