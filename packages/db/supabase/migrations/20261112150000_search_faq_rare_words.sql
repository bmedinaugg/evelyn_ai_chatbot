-- search_faq ranked articles by how many query words they matched, all words equal. With real
-- content, "how does eurokorting work?" returned articles sharing "how does ... work" and missed the
-- one article about "eurokorting". Now each query word is weighted by its rarity across the active
-- articles (inverse document frequency), so a distinctive word outweighs words many articles share.
-- ts_rank_cd stays as a small tie-breaker (title weights, proximity).

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
  with terms as (
    select distinct 'nl'::text as cfg, t.lexeme from unnest(to_tsvector('dutch', q)) t
    union
    select distinct 'en'::text, t.lexeme from unnest(to_tsvector('english', q)) t
  ),
  active as (
    select a.* from public.faq_articles a where a.deleted_at is null
  ),
  matches as (
    select a.id, t.cfg, t.lexeme
    from active a
    join terms t on
      (t.cfg = 'nl' and a.search_nl @@ to_tsquery('simple', quote_literal(t.lexeme)))
      or (t.cfg = 'en' and a.search_en @@ to_tsquery('simple', quote_literal(t.lexeme)))
  ),
  weights as (
    select m.cfg, m.lexeme,
      ln(((select count(*) from active)::float8 + 1) / (count(*)::float8 + 0.5)) as weight
    from matches m
    group by m.cfg, m.lexeme
  ),
  per_lang as (
    select m.id, m.cfg, sum(w.weight) as score
    from matches m
    join weights w on w.cfg = m.cfg and w.lexeme = m.lexeme
    group by m.id, m.cfg
  ),
  hits as (
    select
      a.*,
      max(p.score)
        + 0.1 * greatest(ts_rank_cd(a.search_nl, q_nl), ts_rank_cd(a.search_en, q_en)) as score,
      case
        when preferred_lang = 'nl' and a.title_nl is not null then 'nl'
        when preferred_lang = 'en' and a.title_en is not null then 'en'
        when a.title_nl is not null then 'nl'
        else 'en'
      end as served_lang
    from per_lang p
    join active a on a.id = p.id
    group by a.id, a.folder_id, a.title_nl, a.body_nl, a.url_nl, a.title_en, a.body_en, a.url_en,
      a.content_hash, a.freshdesk_updated_at, a.synced_at, a.deleted_at, a.search_nl, a.search_en
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
