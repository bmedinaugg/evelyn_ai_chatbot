-- Account answers (M2b) may call tools: one customer turn then stores several API messages
-- (assistant tool_use, user tool_result, …, final assistant). They are appended in order and
-- replayed unchanged. p_steps is optional, so existing calls keep working.
drop function public.append_chat_turn(uuid, uuid, jsonb, jsonb, text[]);

create function public.append_chat_turn(
  p_conversation_id uuid,
  p_claim_id uuid,
  p_user jsonb,
  p_assistant jsonb,
  p_flags text[],
  p_steps jsonb default '[]'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_message_id bigint;
  v_reason text;
  v_step jsonb;
begin
  perform 1 from public.conversations
  where id = p_conversation_id and turn_claim_id = p_claim_id
  for update;
  if not found then
    raise exception 'turn claim lost' using errcode = 'TM001';
  end if;
  -- A tool_use without its final answer would make the history unreplayable.
  if p_assistant is null and jsonb_array_length(coalesce(p_steps, '[]'::jsonb)) > 0 then
    raise exception 'tool steps need a final answer';
  end if;

  insert into public.messages (conversation_id, role, display_text, api_content, outcome, citations)
  values (
    p_conversation_id, 'user', p_user ->> 'display_text', p_user -> 'api_content',
    p_user ->> 'outcome', coalesce(p_user -> 'citations', '[]'::jsonb)
  )
  returning id into v_message_id;

  for v_step in select * from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb)) loop
    insert into public.messages (conversation_id, role, display_text, api_content)
    values (p_conversation_id, v_step ->> 'role', '', v_step -> 'api_content');
  end loop;

  if p_assistant is not null then
    insert into public.messages (conversation_id, role, display_text, api_content, outcome, citations)
    values (
      p_conversation_id, 'assistant', p_assistant ->> 'display_text', p_assistant -> 'api_content',
      p_assistant ->> 'outcome', coalesce(p_assistant -> 'citations', '[]'::jsonb)
    )
    returning id into v_message_id;
  end if;

  foreach v_reason in array coalesce(p_flags, array[]::text[]) loop
    insert into public.flags (conversation_id, message_id, reason)
    values (p_conversation_id, v_message_id, v_reason);
  end loop;

  update public.conversations
  set user_message_count = user_message_count + 1,
      last_message_at = now(),
      turn_claimed_at = null,
      turn_claim_id = null
  where id = p_conversation_id;
end;
$$;

revoke execute on function public.append_chat_turn(uuid, uuid, jsonb, jsonb, text[], jsonb) from public, anon, authenticated;
grant execute on function public.append_chat_turn(uuid, uuid, jsonb, jsonb, text[], jsonb) to service_role;
