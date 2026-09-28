-- Exercises RLS isolation and the RPC functions as two different users.
-- Run after the stub, the migration and seed.sql. Any failed assertion raises.
\set ON_ERROR_STOP on

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'alice@example.com', '{"display_name":"Alice"}'),
  ('22222222-2222-4222-8222-222222222222', 'bob@example.com', '{}');

do $$ begin
  assert (select count(*) from public.profiles) = 2, 'profiles created by trigger';
  assert (select display_name from public.profiles where email = 'bob@example.com') = 'bob', 'display name defaults to email prefix';
  assert (select count(*) from public.user_settings) = 2, 'settings created by trigger';
end $$;

-- ---------------------------------------------------------------- Alice
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

do $$
declare
  v_q uuid;
  v_choice uuid;
  v_session uuid;
  v_attempt public.attempts;
  v_exam uuid;
begin
  assert (select count(*) from public.questions) > 0, 'alice can read published questions';
  assert (select count(*) from public.question_catalog) = (select count(*) from public.questions), 'catalog view works under RLS';
  assert (public.bank_stats() ->> 'total')::int > 0, 'bank stats';

  select id into v_q from public.questions order by id limit 1;
  select id into v_choice from public.question_choices where question_id = v_q and is_correct limit 1;

  insert into public.quiz_sessions (mode, title, question_ids) values ('quick', 'Test', array[v_q]) returning id into v_session;

  select * into v_attempt from public.record_attempts(jsonb_build_array(jsonb_build_object(
    'question_id', v_q,
    'quiz_session_id', v_session,
    'selected_choice_ids', jsonb_build_array(v_choice),
    'is_correct', true,
    'confidence', null,
    'time_spent_ms', 12000,
    'answered_at', now(),
    'activity_date', current_date,
    'state_before', null,
    'state', jsonb_build_object(
      'mastery', 1, 'times_seen', 1, 'times_correct', 1, 'times_incorrect', 0, 'correct_streak', 1,
      'interval_days', 1, 'due_at', now() + interval '1 day', 'last_answered_at', now(),
      'last_result', true, 'last_confidence', null, 'last_missed_at', null)
  )));

  assert v_attempt.user_id = '11111111-1111-4111-8111-111111111111', 'attempt owned by caller';
  assert (select answered_count from public.quiz_sessions where id = v_session) = 1, 'session counter updated';
  assert (select mastery from public.review_schedule where question_id = v_q) = 1, 'schedule upserted';
  assert (select last_attempt_id from public.review_schedule where question_id = v_q) = v_attempt.id, 'schedule links attempt';
  assert (select count(*) from public.topic_mastery) > 0, 'topic mastery upserted';
  assert (select questions_answered from public.study_activity) = 1, 'activity recorded';

  -- Duplicate answer in the same session is rejected.
  begin
    perform public.record_attempts(jsonb_build_array(jsonb_build_object(
      'question_id', v_q, 'quiz_session_id', v_session, 'selected_choice_ids', '[]'::jsonb, 'is_correct', false,
      'activity_date', current_date,
      'state', jsonb_build_object('mastery', 1, 'times_seen', 2, 'times_correct', 1, 'times_incorrect', 1, 'correct_streak', 0,
        'interval_days', 0, 'due_at', now(), 'last_answered_at', now(), 'last_result', false))));
    raise exception 'duplicate session answer should fail';
  exception when unique_violation then null;
  end;

  perform public.update_attempt_confidence(v_attempt.id, 'confident', jsonb_build_object(
    'mastery', 2, 'correct_streak', 1, 'interval_days', 4, 'due_at', now() + interval '4 days', 'last_confidence', 'confident'));
  assert (select mastery from public.review_schedule where question_id = v_q) = 2, 'confidence re-applied';
  assert (select confidence from public.attempts where id = v_attempt.id) = 'confident', 'attempt confidence stored';

  insert into public.bookmarks (question_id) values (v_q);
  insert into public.question_notes (question_id, body) values (v_q, 'OCSP checks revocation in real time.');
  insert into public.question_reports (question_id, reason, details) values (v_q, 'typo', 'Small typo');

  -- Exam flow
  insert into public.exam_sessions (preset_id, title, question_ids, time_limit_seconds, expires_at)
  values ('sprint', 'Sprint', array[v_q], 600, now() + interval '10 minutes') returning id into v_exam;
  insert into public.exam_responses (exam_session_id, question_id, selected_choice_ids, flagged) values (v_exam, v_q, array[v_choice], true);
  perform public.finalize_exam(v_exam, '{"total":1,"correct":1}'::jsonb, jsonb_build_array(jsonb_build_object(
    'question_id', v_q, 'selected_choice_ids', jsonb_build_array(v_choice), 'is_correct', true, 'activity_date', current_date,
    'state', jsonb_build_object('mastery', 3, 'times_seen', 2, 'times_correct', 2, 'times_incorrect', 0, 'correct_streak', 2,
      'interval_days', 8, 'due_at', now() + interval '8 days', 'last_answered_at', now(), 'last_result', true))));
  assert (select status from public.exam_sessions where id = v_exam) = 'submitted', 'exam finalized';
  assert (select count(*) from public.attempts where exam_session_id = v_exam) = 1, 'exam attempts recorded';
  -- Finalizing twice is a no-op.
  perform public.finalize_exam(v_exam, '{}'::jsonb, '[]'::jsonb);
  assert (select count(*) from public.attempts where exam_session_id = v_exam) = 1, 'finalize is idempotent';
  -- Responses are locked after submission.
  begin
    update public.exam_responses set flagged = false where exam_session_id = v_exam;
    if found then raise exception 'responses should be locked'; end if;
  exception when insufficient_privilege then null;
  end;

  -- Students cannot write the question bank or escalate their role.
  begin
    perform public.upsert_questions('[]'::jsonb);
    raise exception 'student upsert should fail';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set role = 'admin' where id = auth.uid();
    raise exception 'role escalation should fail';
  exception when insufficient_privilege then null;
  end;
  update public.profiles set display_name = 'Alice A.' where id = auth.uid();

  assert (select count(*) from public.search_questions('PKI')) > 0, 'search by topic acronym';
  assert (select count(*) from public.search_questions('')) > 0, 'empty search lists questions';
  assert (select count(*) from public.list_review_items()) = 1, 'review list shows answered questions';
  assert (select count(*) from public.find_existing_stems(array[(select upper(stem) from public.questions order by id limit 1), 'no such question'])) = 1, 'duplicate stem detection';
  assert (select count(*) from public.list_review_items(p_result => 'incorrect')) = 0, 'review list filters by result';
  assert (select count(*) from public.list_review_items(p_bookmarked => true)) = 1, 'review list filters bookmarks';
end $$;

-- ---------------------------------------------------------------- Bob
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);

do $$
declare
  v_q uuid;
  v_alice_session uuid;
begin
  assert (select count(*) from public.attempts) = 0, 'bob cannot see alice attempts';
  assert (select count(*) from public.review_schedule) = 0, 'bob cannot see alice schedule';
  assert (select count(*) from public.bookmarks) = 0, 'bob cannot see alice bookmarks';
  assert (select count(*) from public.question_notes) = 0, 'bob cannot see alice notes';
  assert (select count(*) from public.quiz_sessions) = 0, 'bob cannot see alice sessions';
  assert (select count(*) from public.exam_sessions) = 0, 'bob cannot see alice exams';
  assert (select count(*) from public.question_reports) = 0, 'bob cannot see alice reports';
  assert (select count(*) from public.list_review_items()) = 0, 'bob review list is empty';
  assert (select count(*) from public.user_settings) = 1, 'bob sees only his settings';
  assert (select count(*) from public.profiles) = 1, 'bob sees only his profile';

  -- Bob cannot attach attempts to Alice's session even if he learns its id.
  set local role postgres;
  select id into v_alice_session from public.quiz_sessions limit 1;
  set local role authenticated;
  select id into v_q from public.questions order by id limit 1;
  begin
    perform public.record_attempts(jsonb_build_array(jsonb_build_object(
      'question_id', v_q, 'quiz_session_id', v_alice_session, 'selected_choice_ids', '[]'::jsonb, 'is_correct', false,
      'activity_date', current_date,
      'state', jsonb_build_object('mastery', 1, 'times_seen', 1, 'times_correct', 0, 'times_incorrect', 1, 'correct_streak', 0,
        'interval_days', 0, 'due_at', now(), 'last_answered_at', now(), 'last_result', false))));
    raise exception 'cross-user session attempt should fail';
  exception when insufficient_privilege then null;
  end;

  -- Bob cannot update Alice's settings.
  update public.user_settings set daily_goal = 50 where user_id = '11111111-1111-4111-8111-111111111111';
  assert not found, 'bob cannot update alice settings';
end $$;

-- ---------------------------------------------------------------- Admin
reset role;
update public.profiles set role = 'admin' where email = 'bob@example.com';
set role authenticated;

do $$
declare
  v_id uuid;
  v_choice uuid;
begin
  select * into v_id from public.upsert_questions(jsonb_build_array(jsonb_build_object(
    'stem', 'Test question from admin?',
    'domain_id', 1,
    'difficulty', 'easy',
    'explanation', 'Because it is.',
    'status', 'draft',
    'choices', jsonb_build_array(
      jsonb_build_object('text', 'Right', 'is_correct', true),
      jsonb_build_object('text', 'Wrong', 'is_correct', false, 'explanation', 'Nope')),
    'topics', jsonb_build_array(jsonb_build_object('id', 'brand-new-topic', 'name', 'Brand New Topic'))
  )));
  assert (select question_type from public.questions where id = v_id) = 'single', 'question created';
  assert exists (select 1 from public.topics where id = 'brand-new-topic'), 'topic auto-created';

  -- Update: keep one choice id, reorder, add another.
  select id into v_choice from public.question_choices where question_id = v_id and is_correct;
  perform public.upsert_questions(jsonb_build_array(jsonb_build_object(
    'id', v_id, 'stem', 'Edited?', 'domain_id', 2, 'difficulty', 'hard', 'explanation', 'Edited.',
    'choices', jsonb_build_array(
      jsonb_build_object('text', 'New wrong', 'is_correct', false),
      jsonb_build_object('id', v_choice, 'text', 'Right (edited)', 'is_correct', true),
      jsonb_build_object('text', 'Also right', 'is_correct', true)),
    'topics', jsonb_build_array(jsonb_build_object('id', 'pki', 'name', 'PKI')))));
  assert (select correct_count from public.questions where id = v_id) = 2, 'multiple answer detected';
  assert (select position from public.question_choices where id = v_choice) = 1, 'choice id preserved and reordered';
  assert (select count(*) from public.question_choices where question_id = v_id) = 3, 'old choice removed';

  delete from public.questions where id = v_id;
  assert not exists (select 1 from public.question_choices where question_id = v_id), 'cascade delete';
end $$;

reset role;
select 'ALL DATABASE TESTS PASSED' as result;
