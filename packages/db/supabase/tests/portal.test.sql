begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

delete from public.conversations;
insert into public.conversations (id, token_hash, lang, created_at, last_message_at, anonymised_at) values
  ('00000000-0000-4000-8000-0000000000f1', 't1', 'nl', now() - interval '2 hours', now() - interval '2 hours', null),
  ('00000000-0000-4000-8000-0000000000f2', 't2', 'en', now() - interval '1 hour', now() - interval '1 hour', null),
  ('00000000-0000-4000-8000-0000000000f3', 't3', 'nl', now() - interval '3 days', now() - interval '3 days', null),
  ('00000000-0000-4000-8000-0000000000f4', 't4', 'nl', now() - interval '100 days', now() - interval '100 days', now());
insert into public.messages (conversation_id, role, display_text, api_content, outcome) values
  ('00000000-0000-4000-8000-0000000000f1', 'user', 'Vraag', '"q"', null),
  ('00000000-0000-4000-8000-0000000000f1', 'assistant', 'Antwoord', '[]', 'no_match');
insert into public.flags (conversation_id, reason, created_at) values
  ('00000000-0000-4000-8000-0000000000f1', 'no_match', now() - interval '2 hours'),
  ('00000000-0000-4000-8000-0000000000f1', 'thumbs_down', now() - interval '90 minutes'),
  ('00000000-0000-4000-8000-0000000000f2', 'wants_human', now() - interval '1 hour'),
  ('00000000-0000-4000-8000-0000000000f4', 'no_match', now() - interval '100 days');
insert into public.escalations (conversation_id, freshdesk_ticket_id, topic, reason)
  values ('00000000-0000-4000-8000-0000000000f2', 4242, 'Payments', 'customer_request');

-- Flagged list: newest flag first, reasons aggregated, anonymised conversations left out.
select results_eq(
  $$select conversation_id::text, reasons, escalated from public.list_flagged_conversations(null, now() - interval '7 days', 50, 0)$$,
  $$values ('00000000-0000-4000-8000-0000000000f2', array['wants_human'], true),
           ('00000000-0000-4000-8000-0000000000f1', array['no_match', 'thumbs_down'], false)$$,
  'flagged conversations, newest first, without anonymised ones'
);
select results_eq(
  $$select conversation_id::text from public.list_flagged_conversations('thumbs_down', now() - interval '7 days', 50, 0)$$,
  $$values ('00000000-0000-4000-8000-0000000000f1')$$,
  'filter by reason'
);
select is(
  (select count(*)::int from public.list_flagged_conversations(null, now() - interval '7 days', 1, 1)),
  1, 'paging'
);
select throws_ok(
  $$select * from public.list_flagged_conversations('nonsense', now(), 50, 0)$$,
  '22023', null, 'unknown reason is rejected'
);

-- Capability switches: flag and audit row in one call.
select lives_ok(
  $$select public.set_capability('get_recent_visits', false, 'oid-admin-1', 'Admin One')$$,
  'switch a capability off'
);
select is(
  (select enabled from public.capability_flags where name = 'get_recent_visits'), false, 'flag stored'
);
select results_eq(
  $$select actor, actor_name, action, entity_id, details ->> 'enabled' from public.audit_log order by id desc limit 1$$,
  $$values ('oid-admin-1', 'Admin One', 'capability.set', 'get_recent_visits', 'false')$$,
  'the switch is audited with the actor'
);
select throws_ok(
  $$select public.set_capability('Drop table; --', true, 'oid', 'x')$$,
  '22023', null, 'capability names are validated'
);

-- Security: RLS, no anon/authenticated access, audit log append-only even for the server.
select ok(
  (select bool_and(rowsecurity) from pg_tables where schemaname = 'public'
     and tablename in ('portal_sessions', 'audit_log')),
  'RLS on portal_sessions and audit_log'
);
select ok(
  not has_table_privilege('anon', 'public.portal_sessions', 'select')
    and not has_table_privilege('authenticated', 'public.audit_log', 'select'),
  'anon and authenticated have no access'
);
select ok(
  has_table_privilege('service_role', 'public.audit_log', 'insert')
    and has_table_privilege('service_role', 'public.audit_log', 'select'),
  'the server can write and read the audit log'
);
select ok(
  not has_table_privilege('service_role', 'public.audit_log', 'update')
    and not has_table_privilege('service_role', 'public.audit_log', 'delete'),
  'the audit log is append-only'
);
select ok(not has_function_privilege('anon', 'public.set_capability(text,boolean,text,text)', 'execute'), 'anon cannot switch');
select ok(not has_function_privilege('anon', 'public.list_flagged_conversations(text,timestamptz,integer,integer,timestamptz)', 'execute'), 'anon cannot list');

-- Sessions store only a hash of the session id.
select ok(
  exists (select 1 from information_schema.columns where table_name = 'portal_sessions' and column_name = 'id_hash')
    and not exists (select 1 from information_schema.columns where table_name = 'portal_sessions' and column_name in ('id', 'token', 'access_token', 'id_token')),
  'portal sessions keep only the session id hash, no Entra tokens'
);
select col_type_is('public', 'portal_sessions', 'roles', 'text[]', 'roles are stored with the session');

select * from finish();
rollback;
