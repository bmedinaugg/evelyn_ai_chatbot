begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

-- Isolate from local data (demo chats, login codes); the transaction is rolled back at the end.
delete from public.otp_challenges;
delete from public.conversations;

-- Two conversations: an old one (100 days) verified with email hash A, and a recent one with hash B.
insert into public.conversations (id, token_hash, lang, created_at, last_message_at,
    verified_email_hash, verified_at, account_candidates, customer_id, studio_id, customer_status)
values
  ('00000000-0000-4000-8000-0000000000a1', 'token-old', 'nl', now() - interval '100 days',
   now() - interval '100 days', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', now() - interval '100 days',
   '[{"customerId":1}]', 1, 1001, 'MEMBER'),
  ('00000000-0000-4000-8000-0000000000b1', 'token-new', 'en', now() - interval '1 hour',
   now() - interval '1 hour', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', now() - interval '1 hour',
   '[{"customerId":2}]', 2, 1002, 'MEMBER');

-- append_chat_turn returns the assistant message id (null without an assistant reply).
update public.conversations set turn_claim_id = '00000000-0000-4000-8000-00000000c1a1'
  where id = '00000000-0000-4000-8000-0000000000b1';
create temp table appended as select public.append_chat_turn(
    '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000c1a1',
    '{"display_text":"Vraag","api_content":"q"}',
    '{"display_text":"Antwoord","api_content":[{"type":"text","text":"a"}],"outcome":"answered"}',
    array[]::text[],
    '[{"role":"assistant","api_content":[{"type":"tool_use"}]},{"role":"user","api_content":[{"type":"tool_result"}]}]'
  ) as id;
select is(
  (select id from appended),
  (select max(id) from public.messages where conversation_id = '00000000-0000-4000-8000-0000000000b1'),
  'append_chat_turn returns the assistant message id'
);
update public.conversations set turn_claim_id = '00000000-0000-4000-8000-00000000c1a2'
  where id = '00000000-0000-4000-8000-0000000000b1';
select is(
  public.append_chat_turn(
    '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000c1a2',
    '{"display_text":"Nog een","api_content":"q2"}', null, array['refusal']),
  null::bigint,
  'no assistant reply: no message id'
);

-- Messages for the old conversation (as if appended long ago).
insert into public.messages (conversation_id, role, display_text, api_content, outcome, created_at)
values
  ('00000000-0000-4000-8000-0000000000a1', 'user', 'Mijn naam is Sam', '"q"', null, now() - interval '100 days'),
  ('00000000-0000-4000-8000-0000000000a1', 'assistant', '', '[{"type":"tool_use","name":"get_memberships"}]', null, now() - interval '100 days'),
  ('00000000-0000-4000-8000-0000000000a1', 'assistant', 'Je contract loopt tot 2027', '[{"type":"text"}]', 'answered', now() - interval '100 days');
insert into public.flags (conversation_id, reason) values ('00000000-0000-4000-8000-0000000000a1', 'no_match');

-- record_feedback: only the conversation's own visible assistant replies.
select ok(
  public.record_feedback('00000000-0000-4000-8000-0000000000b1',
    (select max(id) from public.messages where conversation_id = '00000000-0000-4000-8000-0000000000b1' and role = 'assistant' and display_text <> ''),
    'down'),
  'feedback on an own assistant reply is accepted'
);
select is(
  (select count(*)::int from public.flags where conversation_id = '00000000-0000-4000-8000-0000000000b1' and reason = 'thumbs_down'),
  1, 'thumbs down flags the conversation'
);
select ok(
  public.record_feedback('00000000-0000-4000-8000-0000000000b1',
    (select max(id) from public.messages where conversation_id = '00000000-0000-4000-8000-0000000000b1' and role = 'assistant' and display_text <> ''),
    'up'),
  'a rating can be changed'
);
select is(
  (select rating from public.message_feedback where message_id = (select max(id) from public.messages where conversation_id = '00000000-0000-4000-8000-0000000000b1' and role = 'assistant' and display_text <> '')),
  'up', 'the latest rating counts'
);
select is((select count(*)::int from public.message_feedback), 1, 'one rating per message');
select is(
  (select count(*)::int from public.flags where conversation_id = '00000000-0000-4000-8000-0000000000b1' and reason = 'thumbs_down'),
  1, 'changing the rating does not add flags'
);
select ok(
  not public.record_feedback('00000000-0000-4000-8000-0000000000b1',
    (select min(id) from public.messages where conversation_id = '00000000-0000-4000-8000-0000000000b1'), 'up'),
  'a customer message cannot be rated'
);
select ok(
  not public.record_feedback('00000000-0000-4000-8000-0000000000b1',
    (select id from public.messages where conversation_id = '00000000-0000-4000-8000-0000000000b1' and role = 'assistant' and display_text = '' limit 1), 'up'),
  'a tool step cannot be rated'
);
select ok(
  not public.record_feedback('00000000-0000-4000-8000-0000000000b1',
    (select max(id) from public.messages where conversation_id = '00000000-0000-4000-8000-0000000000a1'), 'down'),
  'another conversation''s message cannot be rated'
);
select throws_ok(
  $$select public.record_feedback('00000000-0000-4000-8000-0000000000b1', 1, 'meh')$$,
  null, null, 'unknown rating is rejected'
);

-- Retention: login codes older than 24 hours, account bindings 24 hours after login.
insert into public.otp_challenges (id, conversation_id, email_hash, code_hash, created_at, expires_at)
values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000b1', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'c1', now() - interval '25 hours', now() - interval '25 hours'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000b1', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'c2', now() - interval '1 hour', now());
select is(public.purge_otp_challenges(now() - interval '24 hours'), 1, 'old login codes are purged');
select is((select count(*)::int from public.otp_challenges), 1, 'recent login codes stay');

update public.conversations set verified_at = now() - interval '25 hours'
  where id = '00000000-0000-4000-8000-0000000000b1';
select is(public.clear_account_bindings(now() - interval '24 hours'), 2, 'bindings older than 24 hours are cleared');
select ok(
  (select customer_id is null and account_candidates is null and verified_email_hash = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
   from public.conversations where id = '00000000-0000-4000-8000-0000000000b1'),
  'binding cleared, verified email hash kept for deletion requests'
);
select is(public.clear_account_bindings(now() - interval '24 hours'), 0, 'clearing is idempotent');

-- Anonymising: conversations without activity for 90 days.
insert into public.escalations (conversation_id, freshdesk_ticket_id, topic, reason)
values ('00000000-0000-4000-8000-0000000000a1', 777, 'Payments', 'stuck');
select is(public.anonymise_conversations(now() - interval '90 days', 100), 1, 'one old conversation anonymised');
select is(
  (select count(*)::int from public.messages
   where conversation_id = '00000000-0000-4000-8000-0000000000a1' and (display_text <> '' or api_content <> '{}'::jsonb)),
  0, 'no text or API content (incl. tool data) left'
);
select ok(
  (select verified_email_hash is null and account_candidates is null and customer_id is null
     and token_hash <> 'token-old' and anonymised_at is not null
   from public.conversations where id = '00000000-0000-4000-8000-0000000000a1'),
  'email hash, binding and token removed; marked anonymised'
);
select ok(
  (select studio_id = 1001 and customer_status = 'MEMBER' from public.conversations where id = '00000000-0000-4000-8000-0000000000a1'),
  'club and status kept for reporting'
);
select is(
  (select outcome from public.messages where conversation_id = '00000000-0000-4000-8000-0000000000a1' and outcome is not null),
  'answered', 'outcomes kept for reporting'
);
select is((select count(*)::int from public.flags where conversation_id = '00000000-0000-4000-8000-0000000000a1'), 1, 'flags kept');
select ok(
  (select display_text = 'Antwoord' from public.messages where conversation_id = '00000000-0000-4000-8000-0000000000b1' and outcome = 'answered'),
  'recent conversations are untouched'
);
select is(public.anonymise_conversations(now() - interval '90 days', 100), 0, 'anonymising is idempotent');

-- Deletion request (DSAR) by email hash.
insert into public.otp_challenges (id, conversation_id, email_hash, code_hash, created_at, expires_at)
values ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000a1',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'c3', now() - interval '2 hours', now());
select results_eq(
  $$select conversations, otp_challenges from public.dsar_delete('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')$$,
  $$values (1, 1)$$,
  'deletes the conversations verified with that email and its login codes'
);
select is(
  (select count(*)::int from public.messages where conversation_id = '00000000-0000-4000-8000-0000000000b1'),
  0, 'their messages are gone'
);
select is((select count(*)::int from public.message_feedback), 0, 'their feedback is gone');
select is((select count(*)::int from public.otp_challenges where email_hash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), 1, 'another email''s login codes stay');
select is((select count(*)::int from public.conversations where id = '00000000-0000-4000-8000-0000000000a1'), 1, 'other conversations stay');
select is((select conversation_id from public.escalations where freshdesk_ticket_id = 777), '00000000-0000-4000-8000-0000000000a1'::uuid, 'escalations of other conversations keep their link');

-- Security: RLS and no access for anon/authenticated (incl. the M3a tables).
select ok(
  (select bool_and(rowsecurity) from pg_tables where schemaname = 'public'
     and tablename in ('message_feedback', 'ticket_topics', 'escalations')),
  'RLS on message_feedback, ticket_topics and escalations'
);
select ok(
  not exists (
    select 1 from unnest(array['message_feedback', 'ticket_topics', 'escalations']) t,
      unnest(array['anon', 'authenticated']) r
    where has_table_privilege(r, 'public.' || t, 'select') or has_table_privilege(r, 'public.' || t, 'insert')
  ),
  'anon and authenticated cannot read or write them'
);
select ok(not has_function_privilege('anon', 'public.record_feedback(uuid,bigint,text)', 'execute'), 'anon cannot rate');
select ok(not has_function_privilege('anon', 'public.anonymise_conversations(timestamptz,integer)', 'execute'), 'anon cannot anonymise');
select ok(not has_function_privilege('authenticated', 'public.dsar_delete(text)', 'execute'), 'authenticated cannot delete');
select ok(has_function_privilege('service_role', 'public.dsar_delete(text)', 'execute'), 'the server can delete');

select * from finish();
rollback;
