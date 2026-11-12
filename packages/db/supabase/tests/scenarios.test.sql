begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

delete from public.scenarios;
delete from public.faq_articles;
insert into public.faq_articles (id, folder_id, title_nl, body_nl, url_nl, title_en, body_en, url_en, content_hash, freshdesk_updated_at)
values (7, 10, 'Bevriezen', 'Zo bevries je.', 'https://portal.test/nl/7', 'Freeze', 'How to freeze.', 'https://portal.test/en/7', 'h7', now());

create temp table ids as
select * from public.create_scenario(
  'oid-agent', 'Agent',
  '{"triggersNl": ["Kan ik mijn abonnement bevriezen tijdens zwangerschap?"],
    "triggersEn": ["Can I freeze my membership during pregnancy?"],
    "answerNl": "Ja, bij zwangerschap kun je tot 6 maanden bevriezen.",
    "answerEn": "Yes, during pregnancy you can freeze for up to 6 months.",
    "statuses": ["MEMBER"], "articleId": 7}'::jsonb
);

select is((select status from public.scenario_versions where id = (select version_id from ids)), 'draft', 'a new scenario starts as a draft');
select is((select version from public.scenario_versions where id = (select version_id from ids)), 1, 'version 1');
select is((select action from public.audit_log order by id desc limit 1), 'scenario.draft', 'drafting is audited');

-- Four eyes: the author cannot publish their own version.
select is(public.publish_scenario_version((select version_id from ids), 'oid-agent', 'Agent'), 'own_version', 'the author cannot publish');
select is((select status from public.scenario_versions where id = (select version_id from ids)), 'draft', 'still a draft');
select is(public.publish_scenario_version((select version_id from ids), 'oid-approver', 'Approver'), 'ok', 'another person publishes');
select results_eq(
  $$select status, published_by from public.scenario_versions where id = (select version_id from ids)$$,
  $$values ('published', 'oid-approver')$$,
  'published by the approver'
);
select is((select action from public.audit_log order by id desc limit 1), 'scenario.publish', 'publishing is audited');

-- Search finds published versions by rare words, in either language.
select results_eq(
  $$select version_id, answer_nl, statuses, article_id, article_title, article_url from public.search_scenarios('bevriezen zwangerschap', 'nl', 3)$$,
  $$select (select version_id from ids), 'Ja, bij zwangerschap kun je tot 6 maanden bevriezen.'::text, array['MEMBER']::text[], 7::bigint, 'Bevriezen'::text, 'https://portal.test/nl/7'::text$$,
  'published scenario is found, with its linked article in the asked language'
);
select is((select count(*)::int from public.search_scenarios('pregnancy freeze', 'en', 3)), 1, 'English triggers work too');

-- A new version is a draft; the published one stays live until the new one is published.
create temp table v2 as
select public.add_scenario_version(
  (select scenario_id from ids), 'oid-approver', 'Approver',
  '{"triggersNl": ["Bevriezen bij zwangerschap?"], "triggersEn": ["Freeze when pregnant?"],
    "answerNl": "Ja, tot 9 maanden.", "answerEn": "Yes, up to 9 months.", "statuses": [], "articleId": null}'::jsonb
) as version_id;
select is((select version from public.scenario_versions where id = (select version_id from v2)), 2, 'version 2');
select is((select answer_nl from public.search_scenarios('zwangerschap', 'nl', 3)), 'Ja, bij zwangerschap kun je tot 6 maanden bevriezen.', 'drafts are not used by the bot');
select is(public.publish_scenario_version((select version_id from v2), 'oid-approver', 'Approver'), 'own_version', 'the approver cannot publish their own version');
select is(public.publish_scenario_version((select version_id from v2), 'oid-agent', 'Agent'), 'ok', 'the agent publishes the approver''s version');
select results_eq(
  $$select version, status from public.scenario_versions where scenario_id = (select scenario_id from ids) order by version$$,
  $$values (1, 'superseded'), (2, 'published')$$,
  'the previous published version is superseded'
);

-- Rollback: re-publishing version 1, under the same four-eyes rule.
select is(public.publish_scenario_version((select version_id from ids), 'oid-agent', 'Agent'), 'own_version', 'its author cannot roll back to it');
select is(public.publish_scenario_version((select version_id from ids), 'oid-admin', 'Admin'), 'ok', 'someone else can');
select is((select count(*)::int from public.scenario_versions where scenario_id = (select scenario_id from ids) and status = 'published'), 1, 'never two published versions');

-- Immutable content.
select throws_ok(
  $$update public.scenario_versions set answer_nl = 'Iets anders' where id = (select version_id from ids)$$,
  null, null, 'published text cannot be changed'
);

-- Archiving withdraws the live version; archived scenarios cannot be published again.
select is(public.archive_scenario((select scenario_id from ids), 'oid-admin', 'Admin'), 'ok', 'archive');
select is((select count(*)::int from public.search_scenarios('zwangerschap', 'nl', 3)), 0, 'archived scenarios are not used');
select is(public.publish_scenario_version((select version_id from v2), 'oid-admin', 'Admin'), 'archived', 'no publishing after archiving');
select is(public.publish_scenario_version(999999, 'oid-admin', 'Admin'), 'not_found', 'unknown version');

-- Validation and security.
select throws_ok(
  $$select public.create_scenario('o', 'n', '{"triggersNl": [], "triggersEn": ["x"], "answerNl": "a", "answerEn": "b", "statuses": [], "articleId": null}'::jsonb)$$,
  null, null, 'at least one trigger example per language'
);
select ok(
  (select bool_and(rowsecurity) from pg_tables where schemaname = 'public' and tablename in ('scenarios', 'scenario_versions'))
    and not has_table_privilege('anon', 'public.scenario_versions', 'select')
    and not has_function_privilege('anon', 'public.publish_scenario_version(bigint,text,text)', 'execute'),
  'RLS on, nothing for anon'
);
select ok(
  not has_column_privilege('service_role', 'public.scenario_versions', 'answer_nl', 'update')
    and has_column_privilege('service_role', 'public.scenario_versions', 'status', 'update'),
  'the server may change the status, never the text'
);

select * from finish();
rollback;
