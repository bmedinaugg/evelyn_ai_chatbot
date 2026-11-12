begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select is(
  (select count(*)::int from pg_extension where extname = 'vector'),
  1,
  'pgvector is installed'
);

select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0,
  'every public table has RLS enabled'
);

create table public.rls_probe (id int);

select ok(
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'rls_probe'),
  'new public tables get RLS automatically'
);

select ok(
  not has_table_privilege('anon', 'public.rls_probe', 'select')
    and not has_table_privilege('authenticated', 'public.rls_probe', 'select'),
  'new public tables are not granted to anon/authenticated'
);

select ok(
  not has_table_privilege('anon', 'public.audit_log', 'select')
    and not has_table_privilege('authenticated', 'public.audit_log', 'insert'),
  'anon/authenticated have no privileges on audit_log'
);

set local role anon;
select throws_ok(
  'select * from public.audit_log',
  '42501',
  null,
  'anon cannot read audit_log'
);
reset role;

-- Second layer: even with a grant, RLS without policies returns nothing.
insert into public.audit_log (actor, action) values ('test', 'probe');
grant select on public.audit_log to authenticated;
set local role authenticated;
select is_empty('select * from public.audit_log', 'RLS hides audit_log rows even when granted');
reset role;

set local role service_role;
select isnt_empty('select * from public.audit_log', 'service_role reads audit_log');
reset role;

select * from finish();
rollback;
