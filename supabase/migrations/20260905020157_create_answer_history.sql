alter table public.user_sync_state
  add column answer_history_import_completed_at timestamptz;

create table public.user_question_attempts (
  user_id uuid not null
    references auth.users (id) on delete cascade,
  attempt_id uuid not null,
  question_key smallint not null
    references public.question_catalog (question_key),
  answer_mask smallint not null,
  score smallint not null,
  source text not null,
  skipped boolean not null default false,
  answered_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (user_id, attempt_id),
  constraint user_question_attempts_answer_mask_check
    check (answer_mask between 0 and 31),
  constraint user_question_attempts_score_check
    check (score between 0 and 5),
  constraint user_question_attempts_source_check
    check (source in ('daily', 'practice', 'study_more', 'exam')),
  constraint user_question_attempts_skipped_payload_check
    check (not skipped or (answer_mask = 0 and score = 0))
);

-- Supports ownership checks and the app's stable, paginated history fetch.
-- The equality column precedes the ordered columns used by PostgREST.
create index user_question_attempts_user_answered_idx
  on public.user_question_attempts (user_id, answered_at, attempt_id);

-- PostgreSQL does not automatically index the referenced side of this FK.
create index user_question_attempts_question_key_idx
  on public.user_question_attempts (question_key);

alter table public.user_question_attempts enable row level security;

create policy "Users can read their own answer attempts"
  on public.user_question_attempts
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own answer attempts"
  on public.user_question_attempts
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own answer attempts"
  on public.user_question_attempts
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- This project opts new public tables out of automatic Data API exposure.
-- Grant only the operations used by the browser client; attempts are immutable.
revoke all on table public.user_question_attempts from anon, authenticated;
grant select, insert, delete on table public.user_question_attempts to authenticated;
