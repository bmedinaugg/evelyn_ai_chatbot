begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into public.conversations (id, token_hash, lang)
values ('00000000-0000-4000-8000-000000000001', 'hash-1', 'nl');

-- Claims: one turn in flight; each claim has its own id; expired claims can be taken again.
create temp table claim (id uuid);
insert into claim select public.claim_conversation_turn('00000000-0000-4000-8000-000000000001');
select ok((select id from claim) is not null, 'first claim returns a claim id');
select is(public.claim_conversation_turn('00000000-0000-4000-8000-000000000001'), null, 'second claim is refused');
update public.conversations set turn_claimed_at = now() - interval '61 seconds'
  where id = '00000000-0000-4000-8000-000000000001';
create temp table stolen (id uuid);
insert into stolen select public.claim_conversation_turn('00000000-0000-4000-8000-000000000001');
select ok((select id from stolen) is not null and (select id from stolen) <> (select id from claim),
  'an expired claim can be taken, with a new id');

-- The old claim holder can no longer write or release.
select throws_ok(
  format($q$select public.append_chat_turn('00000000-0000-4000-8000-000000000001', %L::uuid,
    '{"display_text": "late", "api_content": "late"}'::jsonb, null, array[]::text[])$q$, (select id from claim)),
  'TM001', null, 'a lost claim cannot append');
select lives_ok(
  format($q$select public.release_conversation_turn('00000000-0000-4000-8000-000000000001', %L::uuid)$q$, (select id from claim)),
  'releasing a lost claim is a no-op');
select ok((select turn_claim_id from public.conversations where id = '00000000-0000-4000-8000-000000000001') = (select id from stolen),
  'the new holder keeps its claim');

-- Append a full turn.
select lives_ok($$
  select public.append_chat_turn(
    '00000000-0000-4000-8000-000000000001', (select id from stolen),
    '{"display_text": "Hoe zeg ik op?", "api_content": "<customer_message>Hoe zeg ik op?</customer_message>"}'::jsonb,
    '{"display_text": "Via de app.", "api_content": [{"type": "text", "text": "{}"}], "outcome": "answered",
      "citations": [{"articleId": 900101, "title": "Opzeggen", "url": "https://portal.example/nl/support/solutions/articles/900101"}]}'::jsonb,
    array['low_confidence']
  )
$$, 'append_chat_turn with an assistant message');

select results_eq(
  $$select role, display_text from public.messages
    where conversation_id = '00000000-0000-4000-8000-000000000001' order by id$$,
  $$values ('user'::text, 'Hoe zeg ik op?'::text), ('assistant', 'Via de app.')$$,
  'user then assistant, in order'
);
select is(
  (select m.role from public.flags f join public.messages m on m.id = f.message_id
    where f.conversation_id = '00000000-0000-4000-8000-000000000001'),
  'assistant',
  'flags attach to the assistant message'
);
select results_eq(
  $$select user_message_count, turn_claimed_at is null from public.conversations
    where id = '00000000-0000-4000-8000-000000000001'$$,
  $$values (1, true)$$,
  'count incremented and claim released'
);
create temp table claim2 (id uuid);
insert into claim2 select public.claim_conversation_turn('00000000-0000-4000-8000-000000000001');

-- Append without an assistant message (refusal / error).
select lives_ok($$
  select public.append_chat_turn(
    '00000000-0000-4000-8000-000000000001', (select id from claim2),
    '{"display_text": "nog een vraag", "api_content": "x"}'::jsonb,
    null,
    array['error']
  )
$$, 'append_chat_turn without an assistant message');
select is(
  (select count(*)::int from public.messages where conversation_id = '00000000-0000-4000-8000-000000000001'),
  3,
  'only the user message was added'
);

-- Check constraints.
select throws_ok($$
  select public.claim_conversation_turn('00000000-0000-4000-8000-000000000001');
  select public.append_chat_turn('00000000-0000-4000-8000-000000000001',
    (select turn_claim_id from public.conversations where id = '00000000-0000-4000-8000-000000000001'),
    '{"display_text": "x", "api_content": "x"}'::jsonb,
    '{"display_text": "y", "api_content": [], "outcome": "made_up"}'::jsonb, array[]::text[])
$$, '23514', null, 'unknown outcome rejected');
select throws_ok($$
  select public.claim_conversation_turn('00000000-0000-4000-8000-000000000001');
  select public.append_chat_turn('00000000-0000-4000-8000-000000000001',
    (select turn_claim_id from public.conversations where id = '00000000-0000-4000-8000-000000000001'),
    '{"display_text": "x", "api_content": "x"}'::jsonb, null, array['made_up'])
$$, '23514', null, 'unknown flag reason rejected');

-- Deletes cascade; leads keep no link to a deleted conversation.
insert into public.lead_submissions (conversation_id, freshdesk_ticket_id, lang)
values ('00000000-0000-4000-8000-000000000001', 55, 'nl');
delete from public.conversations where id = '00000000-0000-4000-8000-000000000001';
select is(
  (select count(*)::int from public.messages where conversation_id = '00000000-0000-4000-8000-000000000001')
    + (select count(*)::int from public.flags where conversation_id = '00000000-0000-4000-8000-000000000001'),
  0,
  'messages and flags are deleted with the conversation'
);
select is(
  (select conversation_id from public.lead_submissions where freshdesk_ticket_id = 55),
  null,
  'lead keeps the ticket but loses the conversation link'
);

select ok(
  not has_function_privilege('anon', 'public.claim_conversation_turn(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.append_chat_turn(uuid,uuid,jsonb,jsonb,text[],jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.release_conversation_turn(uuid,uuid)', 'execute'),
  'anon/authenticated cannot execute the turn functions'
);

select * from finish();
rollback;
