-- Owners can delete an exam (cancel an active one or remove it from history).
-- Linked attempts go first: that foreign key does not cascade, and RLS keeps
-- exam attempts out of reach of direct client deletes.
create function private.delete_practice_exam(p_session uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to delete this exam' using errcode='42501'; end if;
  if p_session is null then raise exception 'Invalid exam'; end if;
  -- Serialize with sync_practice_exam. Missing or foreign exams are a no-op so
  -- a retried delete succeeds without revealing other accounts' sessions.
  perform 1 from public.user_exam_sessions where id=p_session and user_id=auth.uid() for update;
  if not found then return false; end if;
  delete from public.user_question_attempts where exam_session_id=p_session and user_id=auth.uid();
  delete from public.user_exam_sessions where id=p_session;
  return true;
end;
$$;
create function public.delete_practice_exam(p_session uuid) returns boolean
language sql security invoker set search_path = '' as $$ select private.delete_practice_exam(p_session); $$;
revoke all on function private.delete_practice_exam(uuid), public.delete_practice_exam(uuid) from public, anon;
grant execute on function private.delete_practice_exam(uuid), public.delete_practice_exam(uuid) to authenticated;

-- Unchanged except for finalization: an exam that reaches its time limit with
-- no classified statements is discarded instead of recording 40 zero scores.
create or replace function private.sync_practice_exam(p_session uuid, p_revision integer, p_edits jsonb, p_submitted_at timestamptz, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_session public.user_exam_sessions; v_edit jsonb; v_q public.user_exam_questions; v_bit integer; v_time timestamptz;
begin
  if auth.uid() is null then raise exception 'Sign in to sync this exam' using errcode='42501'; end if;
  select * into v_session from public.user_exam_sessions where id=p_session and user_id=auth.uid() for update;
  if not found then raise exception 'Exam not found' using errcode='42501'; end if;
  if p_request_id is null then raise exception 'Missing request id'; end if;
  if exists(select 1 from private.exam_sync_receipts where session_id=p_session and request_id=p_request_id) then return private.exam_snapshot(p_session) || '{"acknowledged":true}'::jsonb; end if;
  if v_session.submitted_at is not null then return private.exam_snapshot(p_session) || '{"finalizedElsewhere":true}'::jsonb; end if;
  if p_revision is distinct from v_session.revision then
    return private.exam_snapshot(p_session) || '{"conflict":true}'::jsonb;
  end if;
  if p_edits is null or jsonb_typeof(p_edits)<>'array' or jsonb_array_length(p_edits)>1000 then raise exception 'Invalid edits'; end if;
  if p_submitted_at is not null and (p_submitted_at < v_session.started_at or p_submitted_at > least(v_session.deadline,clock_timestamp()+interval '10 seconds')) then raise exception 'Invalid submission time'; end if;
  for v_edit in select value from jsonb_array_elements(p_edits) loop
    v_time := (v_edit->>'at')::timestamptz;
    if v_time is null or v_time < v_session.started_at or v_time > least(v_session.deadline,coalesce(p_submitted_at,v_session.deadline),clock_timestamp()+interval '10 seconds') then raise exception 'Edit outside exam time'; end if;
    select * into v_q from public.user_exam_questions where session_id=p_session and position=(v_edit->>'position')::integer;
    if not found then raise exception 'Invalid question'; end if;
    if v_edit->>'kind'='answer' then
      if (v_edit->>'statement')::integer not between 0 and 4 or not (v_edit ? 'value') or jsonb_typeof(v_edit->'value') not in ('boolean','null') then raise exception 'Invalid classification'; end if;
      v_bit := 1 << (v_edit->>'statement')::integer;
      update public.user_exam_questions set
        answer_mask = (answer_mask & ~v_bit) | (case when v_edit->>'value'='true' then v_bit else 0 end),
        answered_mask = (answered_mask & ~v_bit) | (case when v_edit->'value'='null'::jsonb then 0 else v_bit end)
        where session_id=p_session and question_key=v_q.question_key;
    elsif v_edit->>'kind'='pin' and jsonb_typeof(v_edit->'value')='boolean' then
      update public.user_exam_questions set pinned=(v_edit->>'value')::boolean where session_id=p_session and question_key=v_q.question_key;
    else raise exception 'Invalid edit'; end if;
  end loop;
  -- Finalize only after the client has drained all pre-deadline queued edits.
  if p_submitted_at is not null then
    v_time := coalesce(p_submitted_at,v_session.deadline);
    -- Clients send the deadline at millisecond precision, so allow a small margin.
    if v_time >= v_session.deadline - interval '1 second'
      and not exists(select 1 from public.user_exam_questions where session_id=p_session and answered_mask<>0) then
      delete from public.user_exam_sessions where id=p_session;
      return jsonb_build_object('id',p_session,'discarded',true,'server_now',now());
    end if;
    insert into public.user_question_attempts(user_id,attempt_id,question_key,answer_mask,answered_mask,score,source,skipped,answered_at,exam_session_id)
      select v_session.user_id,q.attempt_id,q.question_key,q.answer_mask,q.answered_mask,
        bit_count(((~(q.answer_mask # k.correct_mask)) & q.answered_mask)::integer::bit(5)),
        'exam',false,v_time,p_session
      from public.user_exam_questions q join private.exam_pool k using(question_key) where q.session_id=p_session;
    update public.user_exam_sessions set submitted_at=v_time where id=p_session;
    -- Draft values no longer duplicate the final answer history.
    update public.user_exam_questions set answer_mask=0,answered_mask=0 where session_id=p_session;
  end if;
  update public.user_exam_sessions set revision=revision+1 where id=p_session;
  insert into private.exam_sync_receipts(session_id,request_id) values(p_session,p_request_id);
  return private.exam_snapshot(p_session) || '{"acknowledged":true}'::jsonb;
end;
$$;
