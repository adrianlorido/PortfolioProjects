-- =============================================================================
-- Bastion — Security+ study platform: initial schema
--
-- Conventions
--   * Every user-owned table has user_id defaulting to auth.uid() and RLS that
--     restricts rows to their owner. The app never trusts a user id sent from
--     the browser; the database enforces ownership.
--   * The question bank is readable by signed-in users and writable by admins.
--   * Multi-table writes (recording answers, finalizing exams, saving
--     questions) happen in SECURITY INVOKER functions so they are atomic and
--     still subject to RLS.
-- =============================================================================

create extension if not exists pgcrypto;
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create schema if not exists private;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Users
-- -----------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  display_name text not null default '' check (char_length(display_name) <= 80),
  role text not null default 'student' check (role in ('student', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

create table public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  theme text not null default 'system' check (theme in ('light', 'dark', 'system')),
  daily_goal smallint not null default 20 check (daily_goal between 1 and 500),
  default_quiz_size smallint not null default 10 check (default_quiz_size between 1 and 100),
  default_difficulty text not null default 'any' check (default_difficulty in ('any', 'easy', 'medium', 'hard')),
  show_explanations_immediately boolean not null default true,
  confidence_enabled boolean not null default true,
  timer_enabled boolean not null default false,
  timezone text not null default 'UTC' check (char_length(timezone) between 1 and 64),
  updated_at timestamptz not null default now()
);

create trigger user_settings_updated_at before update on public.user_settings
  for each row execute function private.set_updated_at();

-- SECURITY DEFINER so RLS policies can call it without recursion on profiles.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  );
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, ''), '@', 1)), 80)
  )
  on conflict (id) do nothing;
  insert into public.user_settings (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- -----------------------------------------------------------------------------
-- Question bank
-- -----------------------------------------------------------------------------

create table public.domains (
  id smallint primary key check (id between 1 and 9),
  code text not null unique,
  name text not null,
  slug text not null unique,
  weight smallint not null default 0 check (weight between 0 and 100),
  sort_order smallint not null default 0
);

insert into public.domains (id, code, name, slug, weight, sort_order) values
  (1, '1.0', 'General Security Concepts', 'general-security-concepts', 12, 1),
  (2, '2.0', 'Threats, Vulnerabilities, and Mitigations', 'threats-vulnerabilities-mitigations', 22, 2),
  (3, '3.0', 'Security Architecture', 'security-architecture', 18, 3),
  (4, '4.0', 'Security Operations', 'security-operations', 28, 4),
  (5, '5.0', 'Security Program Management and Oversight', 'security-program-management', 20, 5);

create table public.topics (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]*$' and char_length(id) <= 60),
  name text not null check (char_length(name) between 1 and 80),
  domain_hint smallint references public.domains (id),
  keywords text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  stem text not null check (char_length(stem) between 1 and 2000),
  domain_id smallint not null references public.domains (id),
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  question_type text not null check (question_type in ('single', 'multiple')),
  correct_count smallint not null check (correct_count between 1 and 7),
  explanation text not null check (char_length(explanation) between 1 and 5000),
  exam_clue text not null default '' check (char_length(exam_clue) <= 600),
  memory_tip text not null default '' check (char_length(memory_tip) <= 600),
  is_scenario boolean not null default false,
  status text not null default 'published' check (status in ('published', 'draft')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(stem, '')), 'A')
    || setweight(to_tsvector('english', coalesce(exam_clue, '') || ' ' || coalesce(memory_tip, '')), 'B')
    || setweight(to_tsvector('english', coalesce(explanation, '')), 'C')
  ) stored
);

create index questions_published_domain_idx on public.questions (domain_id, difficulty) where status = 'published';
create index questions_updated_idx on public.questions (updated_at desc);
create index questions_search_idx on public.questions using gin (search_vector);
create index questions_stem_trgm_idx on public.questions using gin (stem extensions.gin_trgm_ops);

create trigger questions_updated_at before update on public.questions
  for each row execute function private.set_updated_at();

create table public.question_choices (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions (id) on delete cascade,
  position smallint not null check (position between 0 and 7),
  body text not null check (char_length(body) between 1 and 600),
  is_correct boolean not null default false,
  explanation text check (explanation is null or char_length(explanation) <= 2000),
  constraint question_choices_position_key unique (question_id, position) deferrable initially deferred
);

create index question_choices_question_idx on public.question_choices (question_id, position);

create table public.question_topics (
  question_id uuid not null references public.questions (id) on delete cascade,
  topic_id text not null references public.topics (id) on update cascade on delete cascade,
  primary key (question_id, topic_id)
);

create index question_topics_topic_idx on public.question_topics (topic_id);

-- Lightweight metadata used to generate quizzes without loading question text.
create view public.question_catalog with (security_invoker = true) as
select
  q.id,
  q.domain_id,
  q.difficulty,
  q.question_type,
  q.is_scenario,
  q.status,
  coalesce(array_agg(qt.topic_id order by qt.topic_id) filter (where qt.topic_id is not null), '{}') as topic_ids
from public.questions q
left join public.question_topics qt on qt.question_id = q.id
group by q.id;

-- -----------------------------------------------------------------------------
-- Study sessions
-- -----------------------------------------------------------------------------

create table public.quiz_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  mode text not null check (mode in ('quick', 'domain', 'topic', 'weak', 'missed', 'bookmarked', 'review', 'daily', 'retry', 'custom')),
  title text not null default '' check (char_length(title) <= 120),
  config jsonb not null default '{}',
  question_ids uuid[] not null check (cardinality(question_ids) between 1 and 100),
  status text not null default 'active' check (status in ('active', 'completed', 'abandoned')),
  answered_count integer not null default 0,
  correct_count integer not null default 0,
  time_spent_ms bigint not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index quiz_sessions_user_started_idx on public.quiz_sessions (user_id, started_at desc);

create table public.exam_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  preset_id text not null,
  title text not null default '' check (char_length(title) <= 120),
  question_ids uuid[] not null check (cardinality(question_ids) between 1 and 200),
  time_limit_seconds integer not null check (time_limit_seconds > 0),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  submitted_at timestamptz,
  status text not null default 'in_progress' check (status in ('in_progress', 'submitted')),
  result jsonb
);

create index exam_sessions_user_started_idx on public.exam_sessions (user_id, started_at desc);

create table public.exam_responses (
  exam_session_id uuid not null references public.exam_sessions (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  selected_choice_ids uuid[] not null default '{}' check (cardinality(selected_choice_ids) <= 8),
  flagged boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (exam_session_id, question_id)
);

-- -----------------------------------------------------------------------------
-- Learning history
-- -----------------------------------------------------------------------------

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  quiz_session_id uuid references public.quiz_sessions (id) on delete set null,
  exam_session_id uuid references public.exam_sessions (id) on delete set null,
  selected_choice_ids uuid[] not null default '{}' check (cardinality(selected_choice_ids) <= 8),
  is_correct boolean not null,
  confidence text check (confidence in ('guessed', 'unsure', 'confident')),
  time_spent_ms integer not null default 0 check (time_spent_ms >= 0),
  answered_at timestamptz not null default now(),
  -- Review state before this attempt; lets a confidence rating be applied after grading.
  state_before jsonb
);

create index attempts_user_answered_idx on public.attempts (user_id, answered_at desc);
create index attempts_user_question_idx on public.attempts (user_id, question_id);
create unique index attempts_quiz_question_key on public.attempts (quiz_session_id, question_id) where quiz_session_id is not null;
create unique index attempts_exam_question_key on public.attempts (exam_session_id, question_id) where exam_session_id is not null;

-- Per-question mastery + spaced repetition schedule.
create table public.review_schedule (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  mastery smallint not null default 0 check (mastery between 0 and 4),
  times_seen integer not null default 0,
  times_correct integer not null default 0,
  times_incorrect integer not null default 0,
  correct_streak integer not null default 0,
  interval_days numeric(8, 2) not null default 0,
  due_at timestamptz not null default now(),
  last_answered_at timestamptz not null default now(),
  last_result boolean not null default false,
  last_confidence text check (last_confidence in ('guessed', 'unsure', 'confident')),
  last_missed_at timestamptz,
  last_attempt_id uuid references public.attempts (id) on delete set null,
  primary key (user_id, question_id)
);

create index review_schedule_due_idx on public.review_schedule (user_id, due_at);
create index review_schedule_recent_idx on public.review_schedule (user_id, last_answered_at desc);
create index review_schedule_missed_idx on public.review_schedule (user_id, last_missed_at) where times_incorrect > 0;

create table public.topic_mastery (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  topic_id text not null references public.topics (id) on update cascade on delete cascade,
  attempts integer not null default 0,
  correct integer not null default 0,
  recent_accuracy numeric(6, 5) not null default 0 check (recent_accuracy between 0 and 1),
  last_attempt_at timestamptz not null default now(),
  primary key (user_id, topic_id)
);

create table public.study_activity (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  activity_date date not null,
  questions_answered integer not null default 0,
  questions_correct integer not null default 0,
  time_spent_ms bigint not null default 0,
  primary key (user_id, activity_date)
);

create table public.bookmarks (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

create index bookmarks_user_created_idx on public.bookmarks (user_id, created_at desc);

create table public.question_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, question_id)
);

create trigger question_notes_updated_at before update on public.question_notes
  for each row execute function private.set_updated_at();

create table public.question_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  reason text not null check (reason in ('incorrect_answer', 'unclear', 'typo', 'outdated', 'other')),
  details text not null default '' check (char_length(details) <= 2000),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now()
);

create index question_reports_status_idx on public.question_reports (status, created_at desc);
create index question_reports_user_idx on public.question_reports (user_id);

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.domains enable row level security;
alter table public.topics enable row level security;
alter table public.questions enable row level security;
alter table public.question_choices enable row level security;
alter table public.question_topics enable row level security;
alter table public.quiz_sessions enable row level security;
alter table public.exam_sessions enable row level security;
alter table public.exam_responses enable row level security;
alter table public.attempts enable row level security;
alter table public.review_schedule enable row level security;
alter table public.topic_mastery enable row level security;
alter table public.study_activity enable row level security;
alter table public.bookmarks enable row level security;
alter table public.question_notes enable row level security;
alter table public.question_reports enable row level security;

-- Profiles: users read/update their own row; only display_name is user-editable.
create policy "profiles_select_own" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy "profiles_update_own" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (display_name) on public.profiles to authenticated;

create policy "settings_all_own" on public.user_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Reference data
create policy "domains_read" on public.domains for select to anon, authenticated using (true);
create policy "topics_read" on public.topics for select to authenticated using (true);
create policy "topics_admin_write" on public.topics for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Question bank: published questions for everyone signed in; drafts + writes for admins.
create policy "questions_read" on public.questions for select to authenticated
  using (status = 'published' or (select public.is_admin()));
create policy "questions_admin_insert" on public.questions for insert to authenticated
  with check ((select public.is_admin()));
create policy "questions_admin_update" on public.questions for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "questions_admin_delete" on public.questions for delete to authenticated
  using ((select public.is_admin()));

create policy "choices_read" on public.question_choices for select to authenticated
  using (exists (select 1 from public.questions q where q.id = question_id));
create policy "choices_admin_write" on public.question_choices for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "question_topics_read" on public.question_topics for select to authenticated
  using (exists (select 1 from public.questions q where q.id = question_id));
create policy "question_topics_admin_write" on public.question_topics for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- User-owned data
create policy "quiz_sessions_own" on public.quiz_sessions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "exam_sessions_own" on public.exam_sessions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "exam_responses_select_own" on public.exam_responses for select to authenticated
  using (user_id = (select auth.uid()));
create policy "exam_responses_write_own" on public.exam_responses for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.exam_sessions e
      where e.id = exam_session_id and e.user_id = (select auth.uid()) and e.status = 'in_progress'
    )
  );
create policy "exam_responses_update_own" on public.exam_responses for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.exam_sessions e
      where e.id = exam_session_id and e.user_id = (select auth.uid()) and e.status = 'in_progress'
    )
  );
create policy "exam_responses_delete_own" on public.exam_responses for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "attempts_select_own" on public.attempts for select to authenticated
  using (user_id = (select auth.uid()));
create policy "attempts_insert_own" on public.attempts for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (quiz_session_id is null or exists (
      select 1 from public.quiz_sessions s where s.id = quiz_session_id and s.user_id = (select auth.uid())))
    and (exam_session_id is null or exists (
      select 1 from public.exam_sessions e where e.id = exam_session_id and e.user_id = (select auth.uid())))
  );
create policy "attempts_update_own" on public.attempts for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "attempts_delete_own" on public.attempts for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "review_schedule_own" on public.review_schedule for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "topic_mastery_own" on public.topic_mastery for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "study_activity_own" on public.study_activity for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "bookmarks_own" on public.bookmarks for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "notes_own" on public.question_notes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "reports_insert_own" on public.question_reports for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'open');
create policy "reports_select_own_or_admin" on public.question_reports for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "reports_admin_update" on public.question_reports for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "reports_admin_delete" on public.question_reports for delete to authenticated
  using ((select public.is_admin()));

-- -----------------------------------------------------------------------------
-- Functions: recording answers
-- -----------------------------------------------------------------------------

-- Records one graded answer: attempt row, review schedule, topic mastery,
-- daily activity and quiz-session counters. Grading and scheduling are
-- computed by the application (see src/lib/engine); this function persists.
create or replace function private.record_attempt_item(p_user uuid, p_item jsonb, p_alpha numeric)
returns public.attempts
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attempt public.attempts;
  v_state jsonb := p_item -> 'state';
  v_correct int;
begin
  insert into public.attempts (
    user_id, question_id, quiz_session_id, exam_session_id, selected_choice_ids,
    is_correct, confidence, time_spent_ms, answered_at, state_before
  )
  values (
    p_user,
    (p_item ->> 'question_id')::uuid,
    nullif(p_item ->> 'quiz_session_id', '')::uuid,
    nullif(p_item ->> 'exam_session_id', '')::uuid,
    coalesce(array(select jsonb_array_elements_text(p_item -> 'selected_choice_ids')::uuid), '{}'),
    (p_item ->> 'is_correct')::boolean,
    nullif(p_item ->> 'confidence', ''),
    greatest(0, least(coalesce((p_item ->> 'time_spent_ms')::int, 0), 3600000)),
    coalesce((p_item ->> 'answered_at')::timestamptz, now()),
    nullif(p_item -> 'state_before', 'null'::jsonb)
  )
  returning * into v_attempt;

  v_correct := case when v_attempt.is_correct then 1 else 0 end;

  insert into public.review_schedule as rs (
    user_id, question_id, mastery, times_seen, times_correct, times_incorrect, correct_streak,
    interval_days, due_at, last_answered_at, last_result, last_confidence, last_missed_at, last_attempt_id
  )
  values (
    p_user,
    v_attempt.question_id,
    (v_state ->> 'mastery')::smallint,
    (v_state ->> 'times_seen')::int,
    (v_state ->> 'times_correct')::int,
    (v_state ->> 'times_incorrect')::int,
    (v_state ->> 'correct_streak')::int,
    (v_state ->> 'interval_days')::numeric,
    (v_state ->> 'due_at')::timestamptz,
    (v_state ->> 'last_answered_at')::timestamptz,
    (v_state ->> 'last_result')::boolean,
    nullif(v_state ->> 'last_confidence', ''),
    nullif(v_state ->> 'last_missed_at', '')::timestamptz,
    v_attempt.id
  )
  on conflict (user_id, question_id) do update set
    mastery = excluded.mastery,
    times_seen = excluded.times_seen,
    times_correct = excluded.times_correct,
    times_incorrect = excluded.times_incorrect,
    correct_streak = excluded.correct_streak,
    interval_days = excluded.interval_days,
    due_at = excluded.due_at,
    last_answered_at = excluded.last_answered_at,
    last_result = excluded.last_result,
    last_confidence = excluded.last_confidence,
    last_missed_at = excluded.last_missed_at,
    last_attempt_id = excluded.last_attempt_id;

  insert into public.topic_mastery as tm (user_id, topic_id, attempts, correct, recent_accuracy, last_attempt_at)
  select p_user, qt.topic_id, 1, v_correct, v_correct, v_attempt.answered_at
  from public.question_topics qt
  where qt.question_id = v_attempt.question_id
  on conflict (user_id, topic_id) do update set
    attempts = tm.attempts + 1,
    correct = tm.correct + excluded.correct,
    recent_accuracy = tm.recent_accuracy * (1 - p_alpha) + excluded.recent_accuracy * p_alpha,
    last_attempt_at = greatest(tm.last_attempt_at, excluded.last_attempt_at);

  insert into public.study_activity as sa (user_id, activity_date, questions_answered, questions_correct, time_spent_ms)
  values (p_user, (p_item ->> 'activity_date')::date, 1, v_correct, v_attempt.time_spent_ms)
  on conflict (user_id, activity_date) do update set
    questions_answered = sa.questions_answered + 1,
    questions_correct = sa.questions_correct + excluded.questions_correct,
    time_spent_ms = sa.time_spent_ms + excluded.time_spent_ms;

  if v_attempt.quiz_session_id is not null then
    update public.quiz_sessions
    set answered_count = answered_count + 1,
        correct_count = correct_count + v_correct,
        time_spent_ms = time_spent_ms + v_attempt.time_spent_ms
    where id = v_attempt.quiz_session_id and user_id = p_user;
  end if;

  return v_attempt;
end;
$$;

create or replace function public.record_attempts(p_items jsonb, p_topic_alpha numeric default 0.3)
returns setof public.attempts
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_item jsonb;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then
    raise exception 'p_items must be an array of at most 200 items' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    return next private.record_attempt_item(v_user, v_item, p_topic_alpha);
  end loop;
end;
$$;

-- Applies a confidence rating given after grading. The schedule is only
-- replaced when this attempt is still the question's latest attempt.
create or replace function public.update_attempt_confidence(p_attempt_id uuid, p_confidence text, p_state jsonb)
returns public.attempts
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_attempt public.attempts;
begin
  update public.attempts set confidence = p_confidence
  where id = p_attempt_id and user_id = v_user
  returning * into v_attempt;
  if not found then
    raise exception 'Attempt not found' using errcode = 'P0002';
  end if;

  if p_state is not null and jsonb_typeof(p_state) = 'object' then
    update public.review_schedule set
      mastery = (p_state ->> 'mastery')::smallint,
      correct_streak = (p_state ->> 'correct_streak')::int,
      interval_days = (p_state ->> 'interval_days')::numeric,
      due_at = (p_state ->> 'due_at')::timestamptz,
      last_confidence = nullif(p_state ->> 'last_confidence', '')
    where user_id = v_user and question_id = v_attempt.question_id and last_attempt_id = p_attempt_id;
  end if;
  return v_attempt;
end;
$$;

-- Grades are computed by the app; this persists every answer and the report atomically.
create or replace function public.finalize_exam(p_exam_id uuid, p_result jsonb, p_items jsonb, p_topic_alpha numeric default 0.3)
returns public.exam_sessions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_exam public.exam_sessions;
  v_item jsonb;
begin
  select * into v_exam from public.exam_sessions
  where id = p_exam_id and user_id = v_user
  for update;
  if not found then
    raise exception 'Exam not found' using errcode = 'P0002';
  end if;
  if v_exam.status <> 'in_progress' then
    return v_exam;
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    perform private.record_attempt_item(v_user, v_item || jsonb_build_object('exam_session_id', p_exam_id), p_topic_alpha);
  end loop;

  update public.exam_sessions
  set status = 'submitted', submitted_at = now(), result = p_result
  where id = p_exam_id
  returning * into v_exam;
  return v_exam;
end;
$$;

-- Wipes the caller's study history (keeps bookmarks, notes and settings).
create or replace function public.reset_my_progress()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  delete from public.review_schedule where user_id = v_user;
  delete from public.attempts where user_id = v_user;
  delete from public.topic_mastery where user_id = v_user;
  delete from public.study_activity where user_id = v_user;
  delete from public.quiz_sessions where user_id = v_user;
  delete from public.exam_sessions where user_id = v_user;
end;
$$;

-- -----------------------------------------------------------------------------
-- Functions: question bank
-- -----------------------------------------------------------------------------

-- Creates or updates questions (with choices and topics) atomically.
-- Input: jsonb array of { id?, stem, domain_id, difficulty, explanation,
-- exam_clue, memory_tip, is_scenario, status, choices: [{ id?, text,
-- is_correct, explanation }], topics: [{ id, name }] }. Admin-only via RLS.
create or replace function public.upsert_questions(p_questions jsonb)
returns setof uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_q jsonb;
  v_id uuid;
  v_correct int;
  v_choice_ids uuid[];
begin
  if not public.is_admin() and auth.uid() is not null then
    raise exception 'Only admins can modify questions' using errcode = '42501';
  end if;
  if jsonb_typeof(p_questions) <> 'array' then
    raise exception 'p_questions must be an array' using errcode = '22023';
  end if;

  for v_q in select value from jsonb_array_elements(p_questions) loop
    v_id := coalesce(nullif(v_q ->> 'id', '')::uuid, gen_random_uuid());
    select count(*) into v_correct
    from jsonb_array_elements(v_q -> 'choices') c
    where (c ->> 'is_correct')::boolean;
    if v_correct < 1 then
      raise exception 'Question % must have at least one correct choice', v_id using errcode = '22023';
    end if;

    select coalesce(array_agg((c ->> 'id')::uuid), '{}') into v_choice_ids
    from jsonb_array_elements(v_q -> 'choices') c
    where nullif(c ->> 'id', '') is not null;
    if exists (select 1 from public.question_choices qc where qc.id = any (v_choice_ids) and qc.question_id <> v_id) then
      raise exception 'Choice ids belong to a different question' using errcode = '22023';
    end if;

    insert into public.questions (
      id, stem, domain_id, difficulty, question_type, correct_count, explanation,
      exam_clue, memory_tip, is_scenario, status, created_by
    )
    values (
      v_id,
      v_q ->> 'stem',
      (v_q ->> 'domain_id')::smallint,
      v_q ->> 'difficulty',
      case when v_correct > 1 then 'multiple' else 'single' end,
      v_correct,
      v_q ->> 'explanation',
      coalesce(v_q ->> 'exam_clue', ''),
      coalesce(v_q ->> 'memory_tip', ''),
      coalesce((v_q ->> 'is_scenario')::boolean, false),
      coalesce(nullif(v_q ->> 'status', ''), 'published'),
      auth.uid()
    )
    on conflict (id) do update set
      stem = excluded.stem,
      domain_id = excluded.domain_id,
      difficulty = excluded.difficulty,
      question_type = excluded.question_type,
      correct_count = excluded.correct_count,
      explanation = excluded.explanation,
      exam_clue = excluded.exam_clue,
      memory_tip = excluded.memory_tip,
      is_scenario = excluded.is_scenario,
      status = excluded.status;

    insert into public.topics (id, name)
    select t ->> 'id', t ->> 'name' from jsonb_array_elements(v_q -> 'topics') t
    on conflict (id) do nothing;

    delete from public.question_topics where question_id = v_id;
    insert into public.question_topics (question_id, topic_id)
    select distinct v_id, t ->> 'id' from jsonb_array_elements(v_q -> 'topics') t;

    delete from public.question_choices where question_id = v_id and not (id = any (v_choice_ids));
    insert into public.question_choices (id, question_id, position, body, is_correct, explanation)
    select
      coalesce(nullif(c ->> 'id', '')::uuid, gen_random_uuid()),
      v_id,
      (ord - 1)::smallint,
      c ->> 'text',
      coalesce((c ->> 'is_correct')::boolean, false),
      nullif(c ->> 'explanation', '')
    from jsonb_array_elements(v_q -> 'choices') with ordinality as x(c, ord)
    on conflict (id) do update set
      position = excluded.position,
      body = excluded.body,
      is_correct = excluded.is_correct,
      explanation = excluded.explanation;

    return next v_id;
  end loop;
end;
$$;

-- Full-text + acronym + topic search with pagination. RLS applies (drafts are admin-only).
create or replace function public.search_questions(
  p_query text default '',
  p_domain smallint default null,
  p_topic text default null,
  p_difficulty text default null,
  p_status text default 'published',
  p_limit int default 20,
  p_offset int default 0
)
returns table (id uuid, rank real, total_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select
      nullif(trim(p_query), '') as q,
      '%' || replace(replace(replace(coalesce(trim(p_query), ''), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern,
      case when nullif(trim(p_query), '') is null then null
           else websearch_to_tsquery('english', p_query) end as tsq
  ),
  topic_hits as (
    select qt.question_id
    from public.question_topics qt
    join public.topics t on t.id = qt.topic_id, params p
    where p.q is not null
      and (t.name ilike p.pattern or t.id = lower(p.q) or lower(p.q) = any (t.keywords))
  ),
  matches as (
    select
      q.id,
      q.updated_at,
      (case when p.q is null then 0
            else coalesce(ts_rank(q.search_vector, p.tsq), 0)
               + case when q.stem ilike p.pattern then 0.5 else 0 end
               + case when q.id in (select question_id from topic_hits) then 1 else 0 end
       end)::real as rank
    from public.questions q, params p
    where (p_status is null or q.status = p_status)
      and (p_domain is null or q.domain_id = p_domain)
      and (p_difficulty is null or q.difficulty = p_difficulty)
      and (p_topic is null or exists (
        select 1 from public.question_topics qt where qt.question_id = q.id and qt.topic_id = p_topic))
      and (
        p.q is null
        or q.search_vector @@ p.tsq
        or q.stem ilike p.pattern
        or q.explanation ilike p.pattern
        or q.id in (select question_id from topic_hits)
        or exists (select 1 from public.question_choices c where c.question_id = q.id and c.body ilike p.pattern)
      )
  )
  select m.id, m.rank, count(*) over () as total_count
  from matches m
  order by m.rank desc, m.updated_at desc, m.id
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$$;

-- Aggregate counts for dashboards (published questions only).
create or replace function public.bank_stats()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'total', (select count(*) from public.questions where status = 'published'),
    'by_domain', coalesce((
      select jsonb_object_agg(domain_id, n)
      from (select domain_id, count(*) as n from public.questions where status = 'published' group by domain_id) s
    ), '{}'::jsonb),
    'by_topic', coalesce((
      select jsonb_object_agg(topic_id, n)
      from (
        select qt.topic_id, count(*) as n
        from public.question_topics qt
        join public.questions q on q.id = qt.question_id
        where q.status = 'published'
        group by qt.topic_id
      ) s
    ), '{}'::jsonb),
    'by_difficulty', coalesce((
      select jsonb_object_agg(difficulty, n)
      from (select difficulty, count(*) as n from public.questions where status = 'published' group by difficulty) s
    ), '{}'::jsonb)
  );
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------

grant usage on schema private to authenticated;
revoke all on all functions in schema private from public, anon;
grant execute on function private.record_attempt_item(uuid, jsonb, numeric) to authenticated;

revoke execute on function public.record_attempts(jsonb, numeric) from public, anon;
revoke execute on function public.update_attempt_confidence(uuid, text, jsonb) from public, anon;
revoke execute on function public.finalize_exam(uuid, jsonb, jsonb, numeric) from public, anon;
revoke execute on function public.reset_my_progress() from public, anon;
revoke execute on function public.upsert_questions(jsonb) from public, anon;
revoke execute on function public.search_questions(text, smallint, text, text, text, int, int) from public, anon;
revoke execute on function public.bank_stats() from public, anon;

grant execute on function public.record_attempts(jsonb, numeric) to authenticated;
grant execute on function public.update_attempt_confidence(uuid, text, jsonb) to authenticated;
grant execute on function public.finalize_exam(uuid, jsonb, jsonb, numeric) to authenticated;
grant execute on function public.reset_my_progress() to authenticated;
grant execute on function public.upsert_questions(jsonb) to authenticated;
grant execute on function public.search_questions(text, smallint, text, text, text, int, int) to authenticated;
grant execute on function public.bank_stats() to authenticated;
grant execute on function public.is_admin() to authenticated;
