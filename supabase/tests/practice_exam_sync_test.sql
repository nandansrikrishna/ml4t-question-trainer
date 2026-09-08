-- Run in a transaction and roll back: no test accounts or attempts are retained.
begin;
insert into auth.users(id) values ('c807cc11-1111-4111-8111-111111111111'),('c807cc22-2222-4222-8222-222222222222');
set local role authenticated;
set local request.jwt.claims = '{"sub":"c807cc11-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare s jsonb; r jsonb; edits jsonb; t text;
begin
  s := public.start_practice_exam(1,'c807ccaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  if jsonb_array_length(s->'items')<>40 then raise exception 'Expected 40 questions'; end if;
  if (s->>'deadline')::timestamptz-(s->>'started_at')::timestamptz<>interval '90 minutes' then raise exception 'Deadline wrong'; end if;
  if public.start_practice_exam(1,'c807ccaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->>'id'<>s->>'id' then raise exception 'Start retry not idempotent'; end if;
  if public.start_practice_exam(2,'c807ccbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')->>'id'<>s->>'id' then raise exception 'Concurrent start not prevented'; end if;
  t := s->>'started_at';
  edits:=jsonb_build_array(jsonb_build_object('position',0,'kind','answer','statement',0,'value',false,'at',t),jsonb_build_object('position',0,'kind','pin','value',true,'at',t));
  r:=public.sync_practice_exam((s->>'id')::uuid,0,edits,null,'c807cc01-0000-4000-8000-000000000001');
  if r->'items'->0->>'answered_mask'<>'1' or r->'items'->0->>'answer_mask'<>'0' or r->'items'->0->>'pinned'<>'true' then raise exception 'Draft not saved'; end if;
  r:=public.sync_practice_exam((s->>'id')::uuid,0,edits,null,'c807cc01-0000-4000-8000-000000000001');
  if r->>'revision'<>'1' or r->>'acknowledged'<>'true' then raise exception 'Lost response retry not idempotent'; end if;
  r:=public.sync_practice_exam((s->>'id')::uuid,0,edits,null,'c807cc02-0000-4000-8000-000000000002');
  if r->>'conflict'<>'true' then raise exception 'Revision conflict missed'; end if;
  r:=public.sync_practice_exam((s->>'id')::uuid,1,'[]'::jsonb,(s->>'started_at')::timestamptz,'c807cc03-0000-4000-8000-000000000003');
  if r->>'submitted_at' is null then raise exception 'Submission failed'; end if;
  if (select count(*) from public.user_question_attempts where exam_session_id=(s->>'id')::uuid)<>40 then raise exception 'Expected 40 attempts'; end if;
  if (select sum(score) from public.user_question_attempts where exam_session_id=(s->>'id')::uuid)>1 then raise exception 'Unanswered false statements received credit'; end if;
  if (select sum(answered_mask) from public.user_exam_questions where session_id=(s->>'id')::uuid)<>0 then raise exception 'Drafts still duplicate final answers'; end if;
  r:=public.get_practice_exam((s->>'id')::uuid);
  if r->'items'->0->>'answered_mask'<>'1' then raise exception 'Review not using final attempts'; end if;
  r:=public.sync_practice_exam((s->>'id')::uuid,1,'[]'::jsonb,(s->>'started_at')::timestamptz,'c807cc03-0000-4000-8000-000000000003');
  if (select count(*) from public.user_question_attempts where exam_session_id=(s->>'id')::uuid)<>40 then raise exception 'Duplicate finalization'; end if;
  delete from public.user_question_attempts where user_id='c807cc11-1111-4111-8111-111111111111';
  if (select count(*) from public.user_question_attempts where exam_session_id=(s->>'id')::uuid)<>40 then raise exception 'Reset deleted exam history'; end if;
  begin
    insert into public.user_question_attempts(user_id,attempt_id,question_key,answer_mask,score,source,answered_at,exam_session_id)
    values('c807cc11-1111-4111-8111-111111111111',gen_random_uuid(),(s->'items'->0->>'question_key')::smallint,0,5,'exam',now(),(s->>'id')::uuid);
    raise exception 'Direct exam insertion succeeded';
  exception when insufficient_privilege then null; end;
  begin
    update public.user_exam_sessions set deadline=deadline+interval '1 minute' where id=(s->>'id')::uuid;
    raise exception 'Deadline editing succeeded';
  exception when insufficient_privilege then null; end;
end $$;
do $$ declare s jsonb; items jsonb; r jsonb; begin
  s:=public.get_practice_exam('c807ccaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  select jsonb_agg(jsonb_build_object('question_key',value->'question_key','order',value->'statement_order','answers','[true,null,null,null,null]'::jsonb,'pinned',false)) into items from jsonb_array_elements(s->'items');
  r:=public.import_practice_exam('c807ccdd-dddd-4ddd-8ddd-dddddddddddd',1,now()-interval '2 hours',now()-interval '1 hour',items);
  if (select count(*) from public.user_question_attempts where exam_session_id=(r->>'id')::uuid)<>40 then raise exception 'Legacy import failed'; end if;
  if r->'items'->0->>'answered_mask'<>'1' then raise exception 'Legacy masks lost'; end if;
  r:=public.import_practice_exam('c807ccdd-dddd-4ddd-8ddd-dddddddddddd',1,now()-interval '2 hours',now()-interval '1 hour',items);
  if (select count(*) from public.user_question_attempts where exam_session_id=(r->>'id')::uuid)<>40 then raise exception 'Legacy import duplicated'; end if;
end $$;
set local request.jwt.claims = '{"sub":"c807cc22-2222-4222-8222-222222222222","role":"authenticated"}';
do $$ begin
  if public.get_practice_exam('c807ccaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') is not null then raise exception 'Cross-user read'; end if;
  begin
    perform public.sync_practice_exam('c807ccaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',0,'[]',null,gen_random_uuid());
    raise exception 'Cross-user mutation';
  exception when insufficient_privilege then null; end;
  perform public.start_practice_exam(2,'c807cccc-cccc-4ccc-8ccc-cccccccccccc');
end $$;
reset role;
do $$ begin
  if exists(select 1 from public.user_exam_questions q join private.exam_pool p using(question_key)
    where q.session_id in ('c807ccaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c807cccc-cccc-4ccc-8ccc-cccccccccccc')
    group by q.session_id,p.area,p.domain having count(*)<>2) then raise exception 'Wrong domain distribution'; end if;
end $$;
-- Simulate an expired exam with an answer queued before its deadline.
update public.user_exam_sessions set started_at=started_at-interval '91 minutes',deadline=deadline-interval '91 minutes' where id='c807cccc-cccc-4ccc-8ccc-cccccccccccc';
set local role authenticated;
set local request.jwt.claims = '{"sub":"c807cc22-2222-4222-8222-222222222222","role":"authenticated"}';
do $$ declare s jsonb;r jsonb;begin
  s:=public.get_practice_exam('c807cccc-cccc-4ccc-8ccc-cccccccccccc');
  r:=public.sync_practice_exam('c807cccc-cccc-4ccc-8ccc-cccccccccccc',0,
    jsonb_build_array(jsonb_build_object('position',0,'kind','answer','statement',2,'value',true,'at',s->>'started_at')),
    (s->>'deadline')::timestamptz,gen_random_uuid());
  if r->>'submitted_at'<>s->>'deadline' or r->'items'->0->>'answer_mask'<>'4' then raise exception 'Offline timeout recovery failed'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform public.start_practice_exam(1,gen_random_uuid());raise exception 'Anonymous start allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'PASS: sampling, deadlines, draft sync, conflicts, retries, scoring, final review, reset protection, RLS, offline timeout, anonymous denial' as result;
rollback;
