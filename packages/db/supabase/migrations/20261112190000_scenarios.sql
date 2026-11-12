-- M4b approved answers (scenarios): staff-written nl/en answers the bot shows word for word.
-- Versions are immutable; only an approver other than the author publishes (four eyes).

create table public.scenarios (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by text not null,
  archived_at timestamptz,
  archived_by text
);

-- Generated tsvector columns need an immutable expression; array_to_string itself is only stable.
create function private.join_text(p_values text[])
returns text
language sql
immutable
set search_path = ''
as $$ select array_to_string(p_values, ' ') $$;

create table public.scenario_versions (
  id bigint generated always as identity primary key,
  scenario_id uuid not null references public.scenarios (id) on delete cascade,
  version int not null,
  triggers_nl text[] not null check (cardinality(triggers_nl) between 1 and 10),
  triggers_en text[] not null check (cardinality(triggers_en) between 1 and 10),
  answer_nl text not null check (char_length(answer_nl) between 1 and 1200),
  answer_en text not null check (char_length(answer_en) between 1 and 1200),
  -- Empty: everyone (also when not logged in). Otherwise only logged-in customers with a status.
  statuses text[] not null default '{}' check (statuses <@ array['MEMBER', 'PROSPECT', 'FORMER_MEMBER']),
  article_id bigint references public.faq_articles (id) on delete set null,
  author_oid text not null,
  author_name text not null,
  created_at timestamptz not null default now(),
  status text not null default 'draft' check (status in ('draft', 'published', 'superseded', 'withdrawn')),
  published_by text,
  published_by_name text,
  published_at timestamptz,
  search_nl tsvector generated always as (to_tsvector('dutch', private.join_text(triggers_nl))) stored,
  search_en tsvector generated always as (to_tsvector('english', private.join_text(triggers_en))) stored,
  unique (scenario_id, version)
);
create unique index scenario_versions_one_published on public.scenario_versions (scenario_id)
  where status = 'published';
create index scenario_versions_search_nl on public.scenario_versions using gin (search_nl);
create index scenario_versions_search_en on public.scenario_versions using gin (search_en);

-- Content never changes after insert; edits are new versions.
create function private.scenario_version_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.scenario_id, new.version, new.triggers_nl, new.triggers_en, new.answer_nl, new.answer_en,
      new.statuses, new.author_oid, new.author_name, new.created_at)
     is distinct from
     (old.scenario_id, old.version, old.triggers_nl, old.triggers_en, old.answer_nl, old.answer_en,
      old.statuses, old.author_oid, old.author_name, old.created_at) then
    raise exception 'scenario versions are immutable; create a new version' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger scenario_versions_immutable before update on public.scenario_versions
  for each row execute function private.scenario_version_immutable();

-- Which approved version a bot reply showed (metrics, M5).
alter table public.messages
  add column scenario_version_id bigint references public.scenario_versions (id) on delete set null;

alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check check (action in (
  'capability.set', 'conversation.reveal', 'portal.login',
  'scenario.draft', 'scenario.publish', 'scenario.archive', 'scenario.replay'));

create function private.insert_scenario_version(
  p_scenario_id uuid, p_actor_oid text, p_actor_name text, p_content jsonb
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_id bigint;
  v_version int;
begin
  select coalesce(max(version), 0) + 1 into v_version
  from public.scenario_versions where scenario_id = p_scenario_id;
  insert into public.scenario_versions (
    scenario_id, version, triggers_nl, triggers_en, answer_nl, answer_en, statuses, article_id,
    author_oid, author_name)
  values (
    p_scenario_id, v_version,
    array(select jsonb_array_elements_text(p_content -> 'triggersNl')),
    array(select jsonb_array_elements_text(p_content -> 'triggersEn')),
    p_content ->> 'answerNl', p_content ->> 'answerEn',
    array(select jsonb_array_elements_text(coalesce(p_content -> 'statuses', '[]'::jsonb))),
    nullif(p_content ->> 'articleId', '')::bigint,
    p_actor_oid, p_actor_name)
  returning id into v_id;
  insert into public.audit_log (actor, actor_name, action, entity_type, entity_id, details)
  values (p_actor_oid, p_actor_name, 'scenario.draft', 'scenario', p_scenario_id::text,
    jsonb_build_object('version', v_version));
  return v_id;
end;
$$;

create function public.create_scenario(p_actor_oid text, p_actor_name text, p_content jsonb)
returns table (scenario_id uuid, version_id bigint)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_scenario uuid;
begin
  insert into public.scenarios (created_by) values (p_actor_oid) returning id into v_scenario;
  return query select v_scenario, private.insert_scenario_version(v_scenario, p_actor_oid, p_actor_name, p_content);
end;
$$;

create function public.add_scenario_version(
  p_scenario_id uuid, p_actor_oid text, p_actor_name text, p_content jsonb
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1 from public.scenarios where id = p_scenario_id and archived_at is null for update;
  if not found then
    raise exception 'unknown or archived scenario' using errcode = 'P0002';
  end if;
  return private.insert_scenario_version(p_scenario_id, p_actor_oid, p_actor_name, p_content);
end;
$$;

-- 'ok' | 'not_found' | 'own_version' | 'archived' | 'not_publishable'. Drafts and superseded
-- versions (rollback) can be published; never by their author.
create function public.publish_scenario_version(p_version_id bigint, p_actor_oid text, p_actor_name text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v public.scenario_versions%rowtype;
  v_archived timestamptz;
begin
  select * into v from public.scenario_versions where id = p_version_id;
  if not found then
    return 'not_found';
  end if;
  select archived_at into v_archived from public.scenarios where id = v.scenario_id for update;
  if v_archived is not null then
    return 'archived';
  end if;
  if v.author_oid = p_actor_oid then
    return 'own_version';
  end if;
  if v.status not in ('draft', 'superseded') then
    return 'not_publishable';
  end if;

  update public.scenario_versions set status = 'superseded'
  where scenario_id = v.scenario_id and status = 'published';
  update public.scenario_versions
  set status = 'published', published_by = p_actor_oid, published_by_name = p_actor_name, published_at = now()
  where id = p_version_id;
  insert into public.audit_log (actor, actor_name, action, entity_type, entity_id, details)
  values (p_actor_oid, p_actor_name, 'scenario.publish', 'scenario', v.scenario_id::text,
    jsonb_build_object('version', v.version));
  return 'ok';
end;
$$;

create function public.archive_scenario(p_scenario_id uuid, p_actor_oid text, p_actor_name text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.scenarios set archived_at = now(), archived_by = p_actor_oid
  where id = p_scenario_id and archived_at is null;
  if not found then
    return 'not_found';
  end if;
  update public.scenario_versions set status = 'withdrawn'
  where scenario_id = p_scenario_id and status = 'published';
  insert into public.audit_log (actor, actor_name, action, entity_type, entity_id)
  values (p_actor_oid, p_actor_name, 'scenario.archive', 'scenario', p_scenario_id::text);
  return 'ok';
end;
$$;

-- Published answers whose trigger examples match the question, rare words weighted (as search_faq).
create function public.search_scenarios(query text, preferred_lang text, max_results int default 3)
returns table (
  version_id bigint, scenario_id uuid, triggers text[], answer_nl text, answer_en text,
  statuses text[], article_id bigint, rank real
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  q text := left(coalesce(query, ''), 500);
begin
  if preferred_lang is null or preferred_lang not in ('nl', 'en') then
    raise exception 'unsupported language: %', coalesce(preferred_lang, 'null') using errcode = '22023';
  end if;
  return query
  with terms as (
    select distinct 'nl'::text as cfg, t.lexeme from unnest(to_tsvector('dutch', q)) t
    union
    select distinct 'en'::text, t.lexeme from unnest(to_tsvector('english', q)) t
  ),
  live as (
    select v.* from public.scenario_versions v
    join public.scenarios s on s.id = v.scenario_id
    where v.status = 'published' and s.archived_at is null
  ),
  matches as (
    select l.id, t.cfg, t.lexeme
    from live l
    join terms t on
      (t.cfg = 'nl' and l.search_nl @@ to_tsquery('simple', quote_literal(t.lexeme)))
      or (t.cfg = 'en' and l.search_en @@ to_tsquery('simple', quote_literal(t.lexeme)))
  ),
  weights as (
    select m.cfg, m.lexeme,
      ln(((select count(*) from live)::float8 + 1) / (count(*)::float8 + 0.5)) as weight
    from matches m group by m.cfg, m.lexeme
  ),
  scored as (
    select x.id, max(x.score) as score from (
      select m.id, m.cfg, sum(w.weight) as score
      from matches m join weights w on w.cfg = m.cfg and w.lexeme = m.lexeme
      group by m.id, m.cfg
    ) x group by x.id
  )
  select l.id, l.scenario_id,
    case when preferred_lang = 'nl' then l.triggers_nl else l.triggers_en end,
    l.answer_nl, l.answer_en, l.statuses, l.article_id, s.score::real
  from scored s join live l on l.id = s.id
  order by s.score desc, l.id
  limit least(greatest(coalesce(max_results, 3), 1), 5);
end;
$$;

-- append_chat_turn also stores which approved version a reply showed.
create or replace function public.append_chat_turn(
  p_conversation_id uuid,
  p_claim_id uuid,
  p_user jsonb,
  p_assistant jsonb,
  p_flags text[],
  p_steps jsonb default '[]'::jsonb
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_message_id bigint;
  v_assistant_id bigint;
  v_reason text;
  v_step jsonb;
begin
  perform 1 from public.conversations
  where id = p_conversation_id and turn_claim_id = p_claim_id
  for update;
  if not found then
    raise exception 'turn claim lost' using errcode = 'TM001';
  end if;
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
    insert into public.messages (
      conversation_id, role, display_text, api_content, outcome, citations, scenario_version_id)
    values (
      p_conversation_id, 'assistant', p_assistant ->> 'display_text', p_assistant -> 'api_content',
      p_assistant ->> 'outcome', coalesce(p_assistant -> 'citations', '[]'::jsonb),
      nullif(p_assistant ->> 'scenario_version_id', '')::bigint
    )
    returning id into v_assistant_id;
    v_message_id := v_assistant_id;
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
  return v_assistant_id;
end;
$$;

-- Access: the server only; it may change a version's status fields, never its text.
revoke all on public.scenarios from anon, authenticated, service_role;
revoke all on public.scenario_versions from anon, authenticated, service_role;
grant select, insert, update (archived_at, archived_by) on public.scenarios to service_role;
grant select, insert on public.scenario_versions to service_role;
grant update (status, published_by, published_by_name, published_at) on public.scenario_versions to service_role;
revoke execute on function private.join_text(text[]) from public, anon, authenticated;
revoke execute on function private.insert_scenario_version(uuid, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.create_scenario(text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.add_scenario_version(uuid, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.publish_scenario_version(bigint, text, text) from public, anon, authenticated;
revoke execute on function public.archive_scenario(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.search_scenarios(text, text, int) from public, anon, authenticated;
grant execute on function private.join_text(text[]) to service_role;
grant execute on function private.insert_scenario_version(uuid, text, text, jsonb) to service_role;
grant execute on function public.create_scenario(text, text, jsonb) to service_role;
grant execute on function public.add_scenario_version(uuid, text, text, jsonb) to service_role;
grant execute on function public.publish_scenario_version(bigint, text, text) to service_role;
grant execute on function public.archive_scenario(uuid, text, text) to service_role;
grant execute on function public.search_scenarios(text, text, int) to service_role;
