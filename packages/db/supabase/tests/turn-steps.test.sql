begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into public.conversations (id, token_hash, lang)
values ('00000000-0000-4000-8000-0000000000c1', 'h', 'nl');
create temp table claim (id uuid);
insert into claim select public.claim_conversation_turn('00000000-0000-4000-8000-0000000000c1');

select lives_ok(
  format($q$select public.append_chat_turn(
    '00000000-0000-4000-8000-0000000000c1', %L::uuid,
    '{"display_text": "Wanneer eindigt mijn contract?", "api_content": "<customer_message>…</customer_message>"}'::jsonb,
    '{"display_text": "Je contract loopt tot 31 januari 2027.", "api_content": [{"type": "text", "text": "{}"}], "outcome": "answered"}'::jsonb,
    array[]::text[],
    '[{"role": "assistant", "api_content": [{"type": "tool_use", "id": "t1", "name": "get_memberships", "input": {}}]},
      {"role": "user", "api_content": [{"type": "tool_result", "tool_use_id": "t1", "content": "[]"}]}]'::jsonb
  )$q$, (select id from claim)),
  'append a turn with tool steps'
);

select results_eq(
  $$select role, api_content -> 0 ->> 'type' from public.messages
    where conversation_id = '00000000-0000-4000-8000-0000000000c1' order by id$$,
  $$values ('user'::text, null::text), ('assistant', 'tool_use'), ('user', 'tool_result'), ('assistant', 'text')$$,
  'user, tool_use, tool_result, final answer — in order'
);

insert into claim select public.claim_conversation_turn('00000000-0000-4000-8000-0000000000c1');
select throws_ok(
  format($q$select public.append_chat_turn(
    '00000000-0000-4000-8000-0000000000c1', %L::uuid,
    '{"display_text": "x", "api_content": "x"}'::jsonb, null, array['error'],
    '[{"role": "assistant", "api_content": [{"type": "tool_use", "id": "t2", "name": "get_memberships", "input": {}}]}]'::jsonb
  )$q$, (select id from claim offset 1)),
  'P0001', null,
  'tool steps without a final answer are refused (would break replay)'
);

select * from finish();
rollback;
