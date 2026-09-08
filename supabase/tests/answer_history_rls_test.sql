begin;
select plan(15);

select ok(
  not has_table_privilege('anon', 'public.user_question_attempts', 'select,insert,update,delete'),
  'signed-out clients cannot access answer history'
);
select ok(
  has_table_privilege('authenticated', 'public.user_question_attempts', 'select'),
  'authenticated clients can select attempts'
);
select ok(
  has_table_privilege('authenticated', 'public.user_question_attempts', 'insert'),
  'authenticated clients can insert attempts'
);
select ok(
  has_table_privilege('authenticated', 'public.user_question_attempts', 'delete'),
  'authenticated clients can delete attempts'
);
select ok(
  not has_table_privilege('authenticated', 'public.user_question_attempts', 'update'),
  'answer attempts cannot be updated'
);

insert into auth.users (id)
values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');

insert into public.user_question_attempts (
  user_id,
  attempt_id,
  question_key,
  answer_mask,
  score,
  source,
  answered_at
)
values
  (
    '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select min(question_key) from public.question_catalog),
    5,
    4,
    'practice',
    '2026-09-05 01:00:00+00'
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    (select min(question_key) from public.question_catalog),
    10,
    3,
    'daily',
    '2026-09-05 01:01:00+00'
  );

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';

select results_eq(
  $$select attempt_id from public.user_question_attempts order by attempt_id$$,
  $$values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid)$$,
  'users can read only their own attempts'
);
select lives_ok(
  $$
    insert into public.user_question_attempts (
      user_id, attempt_id, question_key, answer_mask, score, source, answered_at
    ) values (
      '11111111-1111-1111-1111-111111111111',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      (select min(question_key) from public.question_catalog),
      3,
      5,
      'study_more',
      '2026-09-05 01:02:00+00'
    )
  $$,
  'users can insert their own attempts'
);
select lives_ok(
  $$
    insert into public.user_question_attempts (
      user_id, attempt_id, question_key, answer_mask, score, source, answered_at
    ) values (
      '11111111-1111-1111-1111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      (select min(question_key) from public.question_catalog),
      0,
      0,
      'practice',
      '2026-09-05 01:04:00+00'
    ) on conflict (user_id, attempt_id) do nothing
  $$,
  'idempotent attempt retries do not require update access'
);
select is(
  (
    select score
    from public.user_question_attempts
    where attempt_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ),
  4::smallint,
  'an idempotent retry cannot mutate the saved attempt'
);
select throws_ok(
  $$
    insert into public.user_question_attempts (
      user_id, attempt_id, question_key, answer_mask, score, source, answered_at
    ) values (
      '22222222-2222-2222-2222-222222222222',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      (select min(question_key) from public.question_catalog),
      3,
      5,
      'practice',
      '2026-09-05 01:03:00+00'
    )
  $$,
  '42501',
  null,
  'users cannot insert attempts for another user'
);
select throws_ok(
  $$
    update public.user_question_attempts
    set score = 0
    where attempt_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  $$,
  '42501',
  null,
  'users cannot update an existing attempt'
);
select lives_ok(
  $$delete from public.user_question_attempts where user_id = '11111111-1111-1111-1111-111111111111'$$,
  'users can delete their own history'
);

select lives_ok(
  $$delete from public.user_question_attempts where user_id = '22222222-2222-2222-2222-222222222222'$$,
  'cross-user deletes reveal no rows instead of leaking authorization details'
);

reset role;
select is(
  (
    select count(*)
    from public.user_question_attempts
    where user_id = '11111111-1111-1111-1111-111111111111'
  ),
  0::bigint,
  'the owner delete removed all of their attempts'
);
select is(
  (
    select count(*)
    from public.user_question_attempts
    where user_id = '22222222-2222-2222-2222-222222222222'
  ),
  1::bigint,
  'the cross-user delete did not remove another user''s attempt'
);

select * from finish();
rollback;
