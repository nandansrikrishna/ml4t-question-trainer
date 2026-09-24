-- Bookmarks are independent of attempts and exam pins. Keep removal tombstones
-- so reconnecting devices cannot restore an older saved state.
create table public.user_saved_questions (
  user_id uuid not null references auth.users(id) on delete cascade,
  question_key smallint not null references public.question_catalog(question_key),
  saved boolean not null,
  changed_at_ms bigint not null check (changed_at_ms between 0 and 9007199254740991),
  primary key (user_id, question_key)
);
create index user_saved_questions_question_key_idx on public.user_saved_questions(question_key);
alter table public.user_saved_questions enable row level security;
revoke all on public.user_saved_questions from anon, authenticated;
grant select, insert, update on public.user_saved_questions to authenticated;

create policy "Read own bookmarks" on public.user_saved_questions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Insert own bookmarks" on public.user_saved_questions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own bookmarks" on public.user_saved_questions
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.keep_newest_saved_question()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- At an equal timestamp, removal wins. Return the winning row to the client.
  if new.changed_at_ms < old.changed_at_ms
    or (new.changed_at_ms = old.changed_at_ms and not old.saved) then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function public.keep_newest_saved_question() from public, anon, authenticated;
create trigger keep_newest_saved_question before update on public.user_saved_questions
  for each row execute function public.keep_newest_saved_question();
