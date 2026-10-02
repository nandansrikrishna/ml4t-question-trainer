-- Exclude the October 1 withdrawal from new exams while retaining its key and
-- correct mask for historical exam scoring and review.
do $$
declare withdrawn_count integer;
begin
  update private.exam_pool p set is_active = false
  from public.question_catalog c
  where p.question_key = c.question_key
    and c.code = 'ML-D3G1Q6'
    and p.is_active;
  get diagnostics withdrawn_count = row_count;
  if withdrawn_count <> 1 then
    raise exception 'Expected 1 newly withdrawn exam question, updated %', withdrawn_count;
  end if;
end;
$$;
