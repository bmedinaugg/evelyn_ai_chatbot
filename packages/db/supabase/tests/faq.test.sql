begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- Isolate from locally seeded articles; the transaction is rolled back at the end.
delete from public.faq_articles;

insert into public.faq_articles
  (id, folder_id, title_nl, body_nl, url_nl, title_en, body_en, url_en, content_hash, freshdesk_updated_at, deleted_at)
values
  (1, 10, 'Lidmaatschap opzeggen', 'Je kunt je lidmaatschap opzeggen via de app.',
   'https://portal.test/nl/support/solutions/articles/1',
   'Cancel membership', 'You can cancel your membership in the app.',
   'https://portal.test/en/support/solutions/articles/1', 'h1', now(), null),
  (2, 10, 'Openingstijden', 'De club is dagelijks geopend van 7 tot 23 uur.',
   'https://portal.test/nl/support/solutions/articles/2',
   null, null, null, 'h2', now(), null),
  (3, 10, null, null, null,
   'Guest pass', 'Bring a friend with a guest pass once a month.',
   'https://portal.test/en/support/solutions/articles/3', 'h3', now(), null),
  (4, 10, 'Lidmaatschap opzeggen (oud)', 'Oude tekst over opzeggen van je lidmaatschap.',
   'https://portal.test/nl/support/solutions/articles/4',
   'Cancel membership (old)', 'Old text about cancelling your membership.',
   'https://portal.test/en/support/solutions/articles/4', 'h4', now(), now());

select results_eq(
  $$select article_id from public.search_faq('opzegging', 'nl')$$,
  $$values (1::bigint)$$,
  'dutch stemming'
);

select results_eq(
  $$select article_id, lang from public.search_faq('cancelling my membership', 'en')$$,
  $$values (1::bigint, 'en'::text)$$,
  'english stemming + preferred language'
);

select results_eq(
  $$select lang, url from public.search_faq('openingstijden', 'en')$$,
  $$values ('nl'::text, 'https://portal.test/nl/support/solutions/articles/2'::text)$$,
  'fallback to the available language (nl-only)'
);

select results_eq(
  $$select lang from public.search_faq('guest pass', 'nl')$$,
  $$values ('en'::text)$$,
  'fallback to the available language (en-only)'
);

select is_empty(
  $$select 1 from public.search_faq('opzeggen', 'nl') where article_id = 4$$,
  'soft-deleted articles are excluded'
);

select lives_ok($$select * from public.search_faq('', 'nl')$$, 'empty query is fine');
select is_empty($$select * from public.search_faq('', 'nl')$$, 'empty query returns nothing');
select lives_ok(
  $$select * from public.search_faq('!!! & | :* ( ) " '' ; drop table x; --', 'nl')$$,
  'tsquery syntax and punctuation are fine'
);
select lives_ok(
  $$select * from public.search_faq(repeat('opzeggen ', 1000), 'nl')$$,
  'very long query is fine'
);
select ok(
  (select count(*) from public.search_faq('membership', 'en', 50)) <= 10,
  'max_results is clamped to 10'
);
select throws_ok(
  $$select * from public.search_faq('x', 'de')$$,
  null,
  null,
  'unsupported language is rejected'
);
select throws_ok(
  $$insert into public.faq_articles (id, folder_id, title_nl, content_hash, freshdesk_updated_at)
    values (99, 10, 'Alleen titel', 'h', now())$$,
  '23514',
  null,
  'an article needs at least one complete language'
);
select ok(
  not has_function_privilege('anon', 'public.search_faq(text,text,integer)', 'execute'),
  'anon cannot execute search_faq'
);
select ok(
  not has_function_privilege('authenticated', 'public.search_faq(text,text,integer)', 'execute'),
  'authenticated cannot execute search_faq'
);

select * from finish();
rollback;
