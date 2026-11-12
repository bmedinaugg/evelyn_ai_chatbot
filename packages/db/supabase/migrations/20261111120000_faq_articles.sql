-- FAQ knowledge base: approved Freshdesk Solutions articles (nl + en), synced by the worker,
-- searched with Postgres full-text search. Server-only (service_role); RLS is enabled by the
-- baseline event trigger and no grants are given to anon/authenticated.

create table public.faq_articles (
  id bigint primary key, -- Freshdesk article id
  folder_id bigint not null,
  title_nl text,
  body_nl text,
  url_nl text,
  title_en text,
  body_en text,
  url_en text,
  content_hash text not null,
  freshdesk_updated_at timestamptz not null,
  synced_at timestamptz not null default now(),
  deleted_at timestamptz,
  search_nl tsvector generated always as (
    setweight(to_tsvector('dutch', coalesce(title_nl, '')), 'A')
      || setweight(to_tsvector('dutch', coalesce(body_nl, '')), 'B')
  ) stored,
  search_en tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title_en, '')), 'A')
      || setweight(to_tsvector('english', coalesce(body_en, '')), 'B')
  ) stored,
  constraint faq_articles_has_a_language check (
    (title_nl is not null and body_nl is not null and url_nl is not null)
    or (title_en is not null and body_en is not null and url_en is not null)
  )
);

create index faq_articles_search_nl_idx on public.faq_articles using gin (search_nl);
create index faq_articles_search_en_idx on public.faq_articles using gin (search_en);

comment on table public.faq_articles is
  'Published Freshdesk FAQ articles (nl/en). Written only by the FAQ sync; read via search_faq.';

-- Searches both languages and returns each hit in the preferred language when that translation
-- exists, otherwise in the other language, so a citation always has a working URL.
create or replace function public.search_faq(
  query text,
  preferred_lang text,
  max_results int default 5
)
returns table (article_id bigint, lang text, title text, body text, url text, rank real)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  q text := left(coalesce(query, ''), 500);
  q_nl tsquery;
  q_en tsquery;
begin
  if preferred_lang is null or preferred_lang not in ('nl', 'en') then
    raise exception 'unsupported language: %', coalesce(preferred_lang, 'null')
      using errcode = '22023';
  end if;

  q_nl := websearch_to_tsquery('dutch', q);
  q_en := websearch_to_tsquery('english', q);

  return query
  with hits as (
    select
      a.*,
      greatest(ts_rank_cd(a.search_nl, q_nl), ts_rank_cd(a.search_en, q_en)) as score,
      case
        when preferred_lang = 'nl' and a.title_nl is not null then 'nl'
        when preferred_lang = 'en' and a.title_en is not null then 'en'
        when a.title_nl is not null then 'nl'
        else 'en'
      end as served_lang
    from public.faq_articles a
    where a.deleted_at is null
      and (a.search_nl @@ q_nl or a.search_en @@ q_en)
  )
  select
    h.id,
    h.served_lang,
    case when h.served_lang = 'nl' then h.title_nl else h.title_en end,
    case when h.served_lang = 'nl' then h.body_nl else h.body_en end,
    case when h.served_lang = 'nl' then h.url_nl else h.url_en end,
    h.score::real
  from hits h
  order by h.score desc, h.id
  limit least(greatest(coalesce(max_results, 5), 1), 10);
end;
$$;

revoke execute on function public.search_faq(text, text, int) from public, anon, authenticated;
grant execute on function public.search_faq(text, text, int) to service_role;
