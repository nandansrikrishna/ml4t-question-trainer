begin;
-- Plain TAP output keeps this runnable by supabase test db and standalone Postgres.
select '1..1';
insert into auth.users (id) values
  ('33333333-3333-4333-8333-333333333333'),
  ('44444444-4444-4444-8444-444444444444');
insert into public.user_saved_questions(user_id, question_key, saved, changed_at_ms)
  select '44444444-4444-4444-8444-444444444444', min(question_key), true, 10 from public.question_catalog;

set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333"}';
do $$
declare q smallint; n integer; result public.user_saved_questions;
begin
  select min(question_key) into q from public.question_catalog;
  if q is null then raise exception 'Seed the question catalog before running tests'; end if;
  if exists (select from public.user_saved_questions) then raise exception 'Other user bookmarks exposed'; end if;
  insert into public.user_saved_questions values (auth.uid(), q, true, 20);
  select * into strict result from public.user_saved_questions;
  if not result.saved then raise exception 'Own bookmark not saved'; end if;
  update public.user_saved_questions set saved = false, changed_at_ms = 30 where question_key = q;
  -- A retry from an offline device must not resurrect a removal.
  insert into public.user_saved_questions values (auth.uid(), q, true, 20)
    on conflict(user_id, question_key) do update set saved = excluded.saved, changed_at_ms = excluded.changed_at_ms
    returning * into result;
  if result.saved or result.changed_at_ms <> 30 then raise exception 'Stale update overwrote removal'; end if;
  update public.user_saved_questions set saved = true, changed_at_ms = 30 where question_key = q;
  if exists(select from public.user_saved_questions where saved) then raise exception 'Tie resurrected removal'; end if;
  update public.user_saved_questions set saved = true, changed_at_ms = 40 where question_key = q;
  if not exists(select from public.user_saved_questions where saved) then raise exception 'Cannot save again'; end if;
  update public.user_saved_questions set saved = false, changed_at_ms = 50
    where user_id = '44444444-4444-4444-8444-444444444444';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Can update another user'; end if;
  begin
    insert into public.user_saved_questions values ('44444444-4444-4444-8444-444444444444', q, false, 50);
    raise exception 'Can insert for another user';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.user_saved_questions set user_id = '44444444-4444-4444-8444-444444444444', changed_at_ms = 60;
    raise exception 'Can transfer ownership';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.user_saved_questions;
    raise exception 'Can delete removal tombstones';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$
begin
  if has_table_privilege('anon', 'public.user_saved_questions', 'select,insert,update,delete') then
    raise exception 'Anonymous clients have bookmark access';
  end if;
  if not exists(select from public.user_saved_questions where user_id = '44444444-4444-4444-8444-444444444444' and saved and changed_at_ms = 10) then
    raise exception 'Other account changed';
  end if;
end $$;
select 'ok 1 - bookmark persistence, conflict resolution, and account isolation';
rollback;
