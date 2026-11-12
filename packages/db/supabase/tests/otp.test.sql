begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

delete from public.conversations where id in (
  '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1');
insert into public.conversations (id, token_hash, lang) values
  ('00000000-0000-4000-8000-0000000000a1', 'h-a', 'nl'),
  ('00000000-0000-4000-8000-0000000000b1', 'h-b', 'nl');

-- Creating challenges: at most 3 per email hash per window.
select ok(public.create_otp_challenge('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'email-1', 'code-1', 300, 3, 900), 'challenge 1 created');
select ok(public.create_otp_challenge('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a1', 'email-1', 'code-2', 300, 3, 900), 'challenge 2 created');
select ok(public.create_otp_challenge('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000b1', 'email-1', 'code-3', 300, 3, 900), 'challenge 3 created (other conversation, same email)');
select ok(not public.create_otp_challenge('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000a1', 'email-1', 'code-4', 300, 3, 900), 'a fourth challenge for the same email is refused');

-- Wrong codes count; the sixth attempt fails even with the right code.
select is(public.verify_otp_attempt('10000000-0000-4000-8000-000000000002'::uuid, '00000000-0000-4000-8000-0000000000a1'::uuid, 'wrong', 5), 'invalid', 'wrong code');
select is(public.verify_otp_attempt('10000000-0000-4000-8000-000000000002'::uuid, '00000000-0000-4000-8000-0000000000a1'::uuid, 'wrong', 5), 'invalid', 'wrong code 2');
select is(public.verify_otp_attempt('10000000-0000-4000-8000-000000000002'::uuid, '00000000-0000-4000-8000-0000000000a1'::uuid, 'wrong', 5), 'invalid', 'wrong code 3');
select is(public.verify_otp_attempt('10000000-0000-4000-8000-000000000002'::uuid, '00000000-0000-4000-8000-0000000000a1'::uuid, 'wrong', 5), 'invalid', 'wrong code 4');
select is(public.verify_otp_attempt('10000000-0000-4000-8000-000000000002'::uuid, '00000000-0000-4000-8000-0000000000a1'::uuid, 'wrong', 5), 'locked', 'fifth wrong code locks the challenge');
select is(public.verify_otp_attempt('10000000-0000-4000-8000-000000000002'::uuid, '00000000-0000-4000-8000-0000000000a1'::uuid, 'code-2', 5), 'locked', 'the right code no longer works');

-- A code only works for its own conversation.
select is(public.verify_otp_attempt('10000000-0000-4000-8000-000000000003'::uuid, '00000000-0000-4000-8000-0000000000a1'::uuid, 'code-3', 5), 'not_found', 'challenge of another conversation');

-- Success verifies the conversation; the code is single use.
select is(public.verify_otp_attempt('10000000-0000-4000-8000-000000000001'::uuid, '00000000-0000-4000-8000-0000000000a1'::uuid, 'code-1', 5), 'ok', 'right code');
select is((select verified_email_hash from public.conversations where id = '00000000-0000-4000-8000-0000000000a1'), 'email-1', 'conversation verified for that email');
select is(public.verify_otp_attempt('10000000-0000-4000-8000-000000000001'::uuid, '00000000-0000-4000-8000-0000000000a1'::uuid, 'code-1', 5), 'not_found', 'a used code fails');

-- Expired codes fail.
update public.otp_challenges set expires_at = now() - interval '1 second' where id = '10000000-0000-4000-8000-000000000003';
select is(public.verify_otp_attempt('10000000-0000-4000-8000-000000000003'::uuid, '00000000-0000-4000-8000-0000000000b1'::uuid, 'code-3', 5), 'expired', 'expired code');

-- Binding an account: only after verification, only a stored candidate, only once.
select ok(not public.bind_account('00000000-0000-4000-8000-0000000000b1', 0), 'unverified conversation cannot bind');
select public.set_account_candidates('00000000-0000-4000-8000-0000000000a1',
  '[{"customerId": 4, "studioId": 1001, "status": "MEMBER", "studioName": "Club A", "maskedNumber": "•••004"},
    {"customerId": 5, "studioId": 1002, "status": "MEMBER", "studioName": "Club B", "maskedNumber": "•••005"}]');
select ok(not public.bind_account('00000000-0000-4000-8000-0000000000a1', 2), 'out-of-range index refused');
select ok(public.bind_account('00000000-0000-4000-8000-0000000000a1', 1), 'binds candidate 1');
select results_eq(
  $$select customer_id, studio_id, customer_status from public.conversations where id = '00000000-0000-4000-8000-0000000000a1'$$,
  $$values (5::bigint, 1002::bigint, 'MEMBER'::text)$$,
  'bound to the chosen candidate'
);

select * from finish();
rollback;
