begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

delete from public.ticket_topics;
select lives_ok($$select public.replace_ticket_topics(array['Membership', 'Payments'])$$, 'topics replaced');
select results_eq($$select value from public.ticket_topics where active order by value$$,
  $$values ('Membership'::text), ('Payments')$$, 'active topics');
select public.replace_ticket_topics(array['Payments', 'Club']);
select results_eq($$select value from public.ticket_topics where active order by value$$,
  $$values ('Club'::text), ('Payments')$$, 'a topic removed in Freshdesk becomes inactive');
select throws_ok($$select public.replace_ticket_topics(array[]::text[])$$, 'P0001', null, 'an empty topic list is refused');

insert into public.conversations (id, token_hash, lang) values ('00000000-0000-4000-8000-0000000000d1', 'h', 'nl');
insert into public.escalations (conversation_id, freshdesk_ticket_id, topic, reason)
values ('00000000-0000-4000-8000-0000000000d1', 77, 'Payments', 'stuck');
delete from public.conversations where id = '00000000-0000-4000-8000-0000000000d1';
select is((select conversation_id from public.escalations where freshdesk_ticket_id = 77), null, 'escalation kept without the conversation');
select ok(not has_function_privilege('anon', 'public.replace_ticket_topics(text[])', 'execute'), 'anon cannot replace topics');

select * from finish();
rollback;
