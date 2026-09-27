-- Preserve answer keys for existing exams while excluding withdrawn questions
-- from every newly sampled exam.
alter table private.exam_pool add column is_active boolean not null default true;

do $$
declare withdrawn_count integer;
begin
  update private.exam_pool p set is_active = false
  from public.question_catalog c
  where p.question_key = c.question_key
    and c.code in (
      'ML-D1G2Q8', 'ML-D2G4Q5', 'ML-D3G1Q4', 'ML-D3G3Q6',
      'ML-D5G5Q4', 'ML-D6G4Q6', 'ML-D6G5Q5', 'ML-D6G5Q6',
      'QF-D8G4Q1'
    );
  get diagnostics withdrawn_count = row_count;
  if withdrawn_count <> 9 then
    raise exception 'Expected 9 withdrawn exam questions, updated %', withdrawn_count;
  end if;
end;
$$;

create or replace function private.start_practice_exam(p_exam integer, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_id uuid; v_started timestamptz := clock_timestamp();
begin
  if v_user is null then raise exception 'Sign in to start an exam' using errcode='42501'; end if;
  if p_exam not in (1,2) or p_exam is null or p_request_id is null then raise exception 'Invalid exam'; end if;
  -- Serialize concurrent starts for this account and make an uncertain start retry safe.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text,0));
  select id into v_id from public.user_exam_sessions where user_id=v_user and (id=p_request_id or submitted_at is null)
    order by (id=p_request_id) desc limit 1;
  if v_id is not null then return private.exam_snapshot(v_id); end if;
  if exists(select 1 from public.user_exam_sessions where id=p_request_id) then raise exception 'Invalid request id'; end if;
  insert into public.user_exam_sessions(id,user_id,exam,started_at,deadline)
    values(p_request_id,v_user,p_exam,v_started,v_started+interval '90 minutes');
  insert into public.user_exam_questions(session_id,user_id,question_key,position,statement_order)
    select p_request_id,v_user,question_key,(row_number() over(order by random())-1)::smallint,
      (select array_agg(n order by random()) from generate_series(0,4) n where question_key is not null)::smallint[]
    from (select question_key,row_number() over(partition by area,domain order by random()) as rank
      from private.exam_pool where exam=p_exam and is_active) sampled where rank<=2;
  if (select count(*) from public.user_exam_questions where session_id=p_request_id) <> 40 then raise exception 'Incomplete exam pool'; end if;
  return private.exam_snapshot(p_request_id);
end;
$$;
