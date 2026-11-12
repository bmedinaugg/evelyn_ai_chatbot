-- search_faq matched only when every word of the question was in an article (websearch_to_tsquery
-- ANDs terms), so natural questions ("Hoi, ik wil mijn lidmaatschap opzeggen, hoe werkt dat?") found
-- nothing. Now any significant word may match; ts_rank_cd ranks articles matching more words higher.

create or replace function private.any_word_tsquery(config regconfig, query text)
returns tsquery
language sql
immutable
set search_path = ''
as $$
  -- Lexemes are already normalised by the config (stemmed, stop words removed); 'simple' keeps them as is.
  select case
    when count(*) = 0 then null
    else to_tsquery('simple', string_agg(quote_literal(lexeme), ' | '))
  end
  from unnest(to_tsvector(config, query));
$$;

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

  q_nl := private.any_word_tsquery('dutch', q);
  q_en := private.any_word_tsquery('english', q);
  if q_nl is null and q_en is null then
    return;
  end if;

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

revoke execute on function private.any_word_tsquery(regconfig, text) from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.any_word_tsquery(regconfig, text) to service_role;
revoke execute on function public.search_faq(text, text, int) from public, anon, authenticated;
grant execute on function public.search_faq(text, text, int) to service_role;
