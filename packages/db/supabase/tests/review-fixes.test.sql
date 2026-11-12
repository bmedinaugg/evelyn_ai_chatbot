begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

delete from public.otp_challenges;
delete from public.conversations;
insert into public.conversations (id, token_hash, lang) values
  ('00000000-0000-4000-8000-0000000000c1', 'h-c', 'nl');

-- Two people log in one after another on the same conversation (shared device).
do $$ begin perform public.create_otp_challenge('20000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-0000000000c1', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'code-a', 300, 3, 900); end $$;
do $$ begin perform public.verify_otp_attempt('20000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-0000000000c1', 'code-a', 5); end $$;
do $$ begin perform public.create_otp_challenge('20000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-0000000000c1', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'code-b', 300, 3, 900); end $$;
do $$ begin perform public.verify_otp_attempt('20000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-0000000000c1', 'code-b', 5); end $$;

select is(
  (select count(*)::int from public.conversation_logins
   where conversation_id = '00000000-0000-4000-8000-0000000000c1'),
  2, 'every email that logged in to the conversation is remembered'
);

-- The 24-hour clear ends the verified state: no account can be bound again without a new code.
update public.conversations set verified_at = now() - interval '25 hours'
  where id = '00000000-0000-4000-8000-0000000000c1';
do $$ begin perform public.clear_account_bindings(now() - interval '24 hours'); end $$;
select ok(
  (select verified_at is null and verified_email_hash = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
   from public.conversations where id = '00000000-0000-4000-8000-0000000000c1'),
  'verification ended, email hash kept for deletion requests'
);
do $$ begin perform public.set_account_candidates('00000000-0000-4000-8000-0000000000c1',
  '[{"customerId": 4, "studioId": 1001, "status": "MEMBER", "studioName": "Club A", "maskedNumber": "•••004"}]'); end $$;
select is(
  (select account_candidates from public.conversations where id = '00000000-0000-4000-8000-0000000000c1'),
  null, 'no new candidates after the clear'
);
select ok(not public.bind_account('00000000-0000-4000-8000-0000000000c1', 0), 'no binding after the clear');

-- A deletion request for the FIRST person finds the conversation.
select results_eq(
  $$select conversations from public.dsar_delete('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,
  $$values (1)$$,
  'deletion finds conversations of an earlier login'
);
select is(
  (select count(*)::int from public.conversation_logins), 0, 'its login records are gone too'
);

-- Anonymising removes the login records of old conversations.
insert into public.conversations (id, token_hash, lang, created_at, last_message_at) values
  ('00000000-0000-4000-8000-0000000000d1', 'h-d', 'nl', now() - interval '100 days', now() - interval '100 days');
insert into public.conversation_logins (conversation_id, email_hash)
  values ('00000000-0000-4000-8000-0000000000d1', 'dddddddddddddddddddddddddddddddd');
do $$ begin perform public.anonymise_conversations(now() - interval '90 days', 100); end $$;
select is(
  (select count(*)::int from public.conversation_logins where conversation_id = '00000000-0000-4000-8000-0000000000d1'),
  0, 'anonymising removes login records'
);

select ok(
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'conversation_logins'),
  'RLS on conversation_logins'
);
select ok(
  not has_table_privilege('anon', 'public.conversation_logins', 'select')
    and not has_table_privilege('authenticated', 'public.conversation_logins', 'select'),
  'anon and authenticated cannot read conversation_logins'
);

select * from finish();
rollback;
