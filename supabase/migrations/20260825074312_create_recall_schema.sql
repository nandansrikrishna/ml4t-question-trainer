create table public.question_catalog (
  question_key smallint primary key,
  code text not null unique,
  constraint question_catalog_question_key_check
    check (question_key between 1 and 32767),
  constraint question_catalog_code_check
    check (code ~ '^[A-Z0-9-]{1,24}$')
);

create table public.user_question_progress (
  user_id uuid not null
    references auth.users (id) on delete cascade,
  question_key smallint not null
    references public.question_catalog (question_key),
  attempts integer not null default 0,
  statement_correct integer not null default 0,
  statement_total integer not null default 0,
  available_at timestamptz not null,
  interval_minutes integer not null,
  ease real not null,
  last_score smallint not null,
  last_reviewed_at timestamptz not null,
  primary key (user_id, question_key),
  constraint user_question_progress_attempts_check
    check (attempts >= 0),
  constraint user_question_progress_statement_correct_check
    check (statement_correct >= 0),
  constraint user_question_progress_statement_total_check
    check (statement_total >= 0),
  constraint user_question_progress_statement_counts_check
    check (statement_correct <= statement_total),
  constraint user_question_progress_interval_check
    check (interval_minutes between 1 and 52560000),
  constraint user_question_progress_ease_check
    check (ease between 1.3 and 3.0),
  constraint user_question_progress_last_score_check
    check (last_score between 0 and 5)
);

create table public.user_sync_state (
  user_id uuid primary key
    references auth.users (id) on delete cascade,
  initial_local_import_completed_at timestamptz not null
);

-- Supports the authenticated user's availability-ordered fetch. The primary
-- key already covers ownership lookups and cascading deletes by user_id.
create index user_question_progress_available_idx
  on public.user_question_progress (user_id, available_at, question_key);

-- Supports catalog referential checks without adding a redundant identity key.
create index user_question_progress_question_key_idx
  on public.user_question_progress (question_key);

alter table public.question_catalog enable row level security;
alter table public.user_question_progress enable row level security;
alter table public.user_sync_state enable row level security;

create policy "Authenticated users can read the question catalog"
  on public.question_catalog
  for select
  to authenticated
  using ((select auth.uid()) is not null);

create policy "Users can read their own progress"
  on public.user_question_progress
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own progress"
  on public.user_question_progress
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own progress"
  on public.user_question_progress
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own progress"
  on public.user_question_progress
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read their own sync state"
  on public.user_sync_state
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own sync state"
  on public.user_sync_state
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own sync state"
  on public.user_sync_state
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own sync state"
  on public.user_sync_state
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- The project is configured not to auto-expose new public tables. These are
-- the only application grants required by supabase-js/PostgREST.
revoke all on table public.question_catalog from anon, authenticated;
revoke all on table public.user_question_progress from anon, authenticated;
revoke all on table public.user_sync_state from anon, authenticated;

grant select on table public.question_catalog to authenticated;
grant select, insert, update, delete on table public.user_question_progress to authenticated;
grant select, insert, update, delete on table public.user_sync_state to authenticated;

-- Managed projects may install an automatic-RLS event trigger in public when
-- "Enable automatic RLS" is selected at project creation. Keep that safety
-- guard, but move its SECURITY DEFINER function outside the exposed schema and
-- prevent application roles from invoking it directly. Local Supabase stacks
-- that do not install this helper safely skip the block.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    create schema if not exists private;
    revoke all on schema private from public, anon, authenticated;
    alter function public.rls_auto_enable() set schema private;
    revoke all on function private.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$$;
