-- =============================================================================
-- MilestonePay — full Supabase schema
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- It is idempotent: re-running drops and recreates functions/policies/views and
-- only creates tables that do not exist yet.
--
-- What it sets up
--   • profiles            one row per auth user (client or freelancer)
--   • projects            a client's project, assigned to one freelancer
--   • milestones          priced, ordered deliverables within a project
--   • criteria            weighted acceptance criteria for each milestone
--   • submissions         a freelancer's repository submission for a milestone
--   • verifications       the scored result of a submission
--   • verification_results per-criterion pass/fail + evidence
--   • revisions           client revision requests
--   • payments            simulated PayPal Sandbox authorizations / captures / releases
--   • reviews             client reviews of freelancers (only after a capture)
--   • activity            project activity feed
--   • storage bucket `resumes` (private, readable by signed-in users)
--
-- Security model
--   Row Level Security is on for every table. Users can only read rows for
--   projects they belong to. All state changes (create, fund, submit, approve,
--   request revision, review) go through SECURITY DEFINER functions that check
--   the caller's role and the current state, so the browser can never write
--   amounts, statuses or payments directly.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.user_role as enum ('client', 'freelancer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.project_status as enum ('draft', 'in_progress', 'completed', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.milestone_status as enum ('not_started', 'in_progress', 'submitted', 'revision_requested', 'approved');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.criterion_type as enum ('CI_PASSES', 'FILE_EXISTS', 'PR_MERGED', 'MANUAL_REVIEW');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.verification_status as enum ('pending_review', 'approved', 'revision_requested', 'superseded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_kind as enum ('authorization', 'capture', 'release');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  role             public.user_role not null default 'client',
  full_name        text not null default '',
  email            text not null default '',
  company          text not null default '',
  headline         text not null default '',
  bio              text not null default '',
  skills           text[] not null default '{}',
  portfolio_url    text not null default '',
  github_username  text not null default '',
  resume_path      text,          -- object key inside the `resumes` bucket
  resume_name      text,
  resume_size      integer,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint profiles_bio_len check (char_length(bio) <= 1000),
  constraint profiles_headline_len check (char_length(headline) <= 120),
  constraint profiles_portfolio_http check (portfolio_url = '' or portfolio_url ~* '^https?://')
);

create table if not exists public.projects (
  id                       uuid primary key default gen_random_uuid(),
  client_id                uuid not null references public.profiles (id) on delete cascade,
  freelancer_id            uuid references public.profiles (id) on delete set null,
  title                    text not null check (char_length(title) between 3 and 140),
  brief                    text not null check (char_length(brief) between 20 and 4000),
  budget_cents             bigint not null check (budget_cents > 0 and budget_cents <= 100000000),
  currency                 text not null default 'USD',
  status                   public.project_status not null default 'draft',
  paypal_authorization_id  text,
  authorized_at            timestamptz,
  completed_at             timestamptz,
  created_at               timestamptz not null default now()
);
create index if not exists projects_client_idx on public.projects (client_id);
create index if not exists projects_freelancer_idx on public.projects (freelancer_id);

create table if not exists public.milestones (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  position        integer not null check (position >= 1),
  title           text not null check (char_length(title) between 2 and 140),
  description     text not null default '',
  percent         numeric(5,2) not null check (percent > 0 and percent <= 100),
  amount_cents    bigint not null check (amount_cents >= 0),
  captured_cents  bigint not null default 0 check (captured_cents >= 0),
  status          public.milestone_status not null default 'not_started',
  due_date        date,
  approved_at     timestamptz,
  created_at      timestamptz not null default now(),
  unique (project_id, position)
);
create index if not exists milestones_project_idx on public.milestones (project_id);

create table if not exists public.criteria (
  id            uuid primary key default gen_random_uuid(),
  milestone_id  uuid not null references public.milestones (id) on delete cascade,
  position      integer not null default 1,
  type          public.criterion_type not null,
  description   text not null check (char_length(description) between 2 and 400),
  weight        integer not null check (weight > 0 and weight <= 100),
  config        jsonb not null default '{}'::jsonb   -- e.g. {"path": "docs/openapi.yaml"}
);
create index if not exists criteria_milestone_idx on public.criteria (milestone_id);

create table if not exists public.submissions (
  id             uuid primary key default gen_random_uuid(),
  milestone_id   uuid not null references public.milestones (id) on delete cascade,
  freelancer_id  uuid not null references public.profiles (id) on delete cascade,
  repo_url       text not null check (repo_url ~* '^https://github\.com/[^/]+/[^/]+'),
  commit_sha     text,
  notes          text not null default '',
  created_at     timestamptz not null default now()
);
create index if not exists submissions_milestone_idx on public.submissions (milestone_id);

create table if not exists public.verifications (
  id              uuid primary key default gen_random_uuid(),
  submission_id   uuid not null references public.submissions (id) on delete cascade,
  milestone_id    uuid not null references public.milestones (id) on delete cascade,
  score_percent   numeric(5,2) not null default 0,
  proposed_cents  bigint not null default 0,
  status          public.verification_status not null default 'pending_review',
  created_at      timestamptz not null default now(),
  decided_at      timestamptz
);
create index if not exists verifications_milestone_idx on public.verifications (milestone_id);

create table if not exists public.verification_results (
  id               uuid primary key default gen_random_uuid(),
  verification_id  uuid not null references public.verifications (id) on delete cascade,
  criterion_id     uuid not null references public.criteria (id) on delete cascade,
  passed           boolean,               -- null = awaiting client review
  evidence         text not null default '',
  source           text not null default 'github' check (source in ('github', 'manual')),
  unique (verification_id, criterion_id)
);

create table if not exists public.revisions (
  id               uuid primary key default gen_random_uuid(),
  milestone_id     uuid not null references public.milestones (id) on delete cascade,
  verification_id  uuid references public.verifications (id) on delete set null,
  client_id        uuid not null references public.profiles (id) on delete cascade,
  message          text not null check (char_length(message) between 5 and 2000),
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz
);
create index if not exists revisions_milestone_idx on public.revisions (milestone_id);

create table if not exists public.payments (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  milestone_id  uuid references public.milestones (id) on delete set null,
  kind          public.payment_kind not null,
  amount_cents  bigint not null check (amount_cents >= 0),
  reference     text not null,
  created_at    timestamptz not null default now()
);
create index if not exists payments_project_idx on public.payments (project_id);

create table if not exists public.reviews (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete cascade,
  client_id      uuid not null references public.profiles (id) on delete cascade,
  freelancer_id  uuid not null references public.profiles (id) on delete cascade,
  rating         integer not null check (rating between 1 and 5),
  body           text not null check (char_length(body) between 10 and 2000),
  created_at     timestamptz not null default now(),
  unique (project_id, client_id)
);
create index if not exists reviews_freelancer_idx on public.reviews (freelancer_id);

create table if not exists public.activity (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  actor_id    uuid references public.profiles (id) on delete set null,
  kind        text not null,
  message     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists activity_project_idx on public.activity (project_id, created_at desc);

-- -----------------------------------------------------------------------------
-- New-user trigger: create a profile from sign-up metadata
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  r text := meta->>'role';
  url text := coalesce(meta->>'portfolio_url', '');
begin
  if url <> '' and url !~* '^https?://' then url := ''; end if;
  insert into public.profiles (id, role, full_name, email, company, headline, bio, skills, portfolio_url, github_username)
  values (
    new.id,
    case when r in ('client', 'freelancer') then r::public.user_role else 'client' end,
    left(coalesce(meta->>'full_name', ''), 120),
    coalesce(new.email, ''),
    left(coalesce(meta->>'company', ''), 140),
    left(coalesce(meta->>'headline', ''), 120),
    left(coalesce(meta->>'bio', ''), 1000),
    coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(meta->'skills') = 'array' then meta->'skills' else '[]'::jsonb end)), '{}'),
    url,
    left(coalesce(meta->>'github_username', ''), 60)
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Membership helpers (used by RLS)
-- -----------------------------------------------------------------------------
create or replace function public.is_project_member(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects p
    where p.id = p_project_id and (p.client_id = auth.uid() or p.freelancer_id = auth.uid())
  );
$$;

create or replace function public.milestone_project(p_milestone_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select project_id from public.milestones where id = p_milestone_id;
$$;

create or replace function public.verification_project(p_verification_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select m.project_id from public.verifications v join public.milestones m on m.id = v.milestone_id
  where v.id = p_verification_id;
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.profiles             enable row level security;
alter table public.projects             enable row level security;
alter table public.milestones           enable row level security;
alter table public.criteria             enable row level security;
alter table public.submissions          enable row level security;
alter table public.verifications        enable row level security;
alter table public.verification_results enable row level security;
alter table public.revisions            enable row level security;
alter table public.payments             enable row level security;
alter table public.reviews              enable row level security;
alter table public.activity             enable row level security;

-- Explicit table privileges (RLS below still decides which rows are visible).
revoke all on public.profiles, public.projects, public.milestones, public.criteria, public.submissions,
              public.verifications, public.verification_results, public.revisions, public.payments,
              public.reviews, public.activity from anon;
grant select on public.profiles, public.projects, public.milestones, public.criteria, public.submissions,
                public.verifications, public.verification_results, public.revisions, public.payments,
                public.reviews, public.activity to authenticated;
grant delete on public.projects to authenticated;

-- profiles: you can read and edit your own row. Other people's public fields
-- are exposed through the public_profiles view below (no email).
drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles
  for select to authenticated using (id = auth.uid());

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Only these columns are editable by the user (role and email are not).
revoke update on public.profiles from authenticated;
grant update (full_name, company, headline, bio, skills, portfolio_url, github_username,
              resume_path, resume_name, resume_size) on public.profiles to authenticated;

-- projects and children: members can read; writes go through functions.
drop policy if exists "projects: members read" on public.projects;
create policy "projects: members read" on public.projects
  for select to authenticated using (client_id = auth.uid() or freelancer_id = auth.uid());

drop policy if exists "projects: client deletes draft" on public.projects;
create policy "projects: client deletes draft" on public.projects
  for delete to authenticated using (client_id = auth.uid() and status = 'draft');

drop policy if exists "milestones: members read" on public.milestones;
create policy "milestones: members read" on public.milestones
  for select to authenticated using (public.is_project_member(project_id));

drop policy if exists "criteria: members read" on public.criteria;
create policy "criteria: members read" on public.criteria
  for select to authenticated using (public.is_project_member(public.milestone_project(milestone_id)));

drop policy if exists "submissions: members read" on public.submissions;
create policy "submissions: members read" on public.submissions
  for select to authenticated using (public.is_project_member(public.milestone_project(milestone_id)));

drop policy if exists "verifications: members read" on public.verifications;
create policy "verifications: members read" on public.verifications
  for select to authenticated using (public.is_project_member(public.milestone_project(milestone_id)));

drop policy if exists "verification_results: members read" on public.verification_results;
create policy "verification_results: members read" on public.verification_results
  for select to authenticated using (public.is_project_member(public.verification_project(verification_id)));

drop policy if exists "revisions: members read" on public.revisions;
create policy "revisions: members read" on public.revisions
  for select to authenticated using (public.is_project_member(public.milestone_project(milestone_id)));

drop policy if exists "payments: members read" on public.payments;
create policy "payments: members read" on public.payments
  for select to authenticated using (public.is_project_member(project_id));

drop policy if exists "activity: members read" on public.activity;
create policy "activity: members read" on public.activity
  for select to authenticated using (public.is_project_member(project_id));

-- reviews are public to signed-in users (shown on freelancer profiles).
drop policy if exists "reviews: signed-in read" on public.reviews;
create policy "reviews: signed-in read" on public.reviews
  for select to authenticated using (true);

-- -----------------------------------------------------------------------------
-- Public views (run as owner, expose only non-sensitive columns)
-- -----------------------------------------------------------------------------
drop view if exists public.freelancer_stats;
drop view if exists public.public_profiles;

create view public.public_profiles as
  select id, role, full_name, company, headline, bio, skills, portfolio_url, github_username,
         resume_path, resume_name, resume_size, created_at
  from public.profiles;

create view public.freelancer_stats as
  select
    pr.id as freelancer_id,
    (select count(*) from public.milestones m join public.projects p on p.id = m.project_id
       where p.freelancer_id = pr.id and m.status = 'approved')                         as verified_milestones,
    (select coalesce(sum(pay.amount_cents), 0) from public.payments pay join public.projects p on p.id = pay.project_id
       where p.freelancer_id = pr.id and pay.kind = 'capture')                         as captured_cents,
    (select count(*) from public.projects p where p.freelancer_id = pr.id and p.status = 'completed') as completed_projects,
    (select round(100.0 * count(*) filter (where vr.passed) / nullif(count(*) filter (where vr.passed is not null), 0), 1)
       from public.verification_results vr
       join public.verifications v on v.id = vr.verification_id
       join public.submissions s on s.id = v.submission_id
       where s.freelancer_id = pr.id)                                                  as pass_rate,
    (select round(avg(rating)::numeric, 2) from public.reviews r where r.freelancer_id = pr.id) as avg_rating,
    (select count(*) from public.reviews r where r.freelancer_id = pr.id)              as review_count
  from public.profiles pr
  where pr.role = 'freelancer';

revoke all on public.public_profiles, public.freelancer_stats from anon, public;
grant select on public.public_profiles, public.freelancer_stats to authenticated;

-- -----------------------------------------------------------------------------
-- Internal helpers
-- -----------------------------------------------------------------------------
create or replace function public.sandbox_ref(prefix text)
returns text language sql volatile as $$
  select prefix || '-' || upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10));
$$;

create or replace function public.log_activity(p_project uuid, p_kind text, p_message text)
returns void language sql security definer set search_path = public as $$
  insert into public.activity (project_id, actor_id, kind, message) values (p_project, auth.uid(), p_kind, p_message);
$$;

-- Recalculate a verification's score and proposed amount from its results.
-- Only passed criteria count; criteria awaiting review (null) count as not passed.
create or replace function public.recompute_verification(p_verification_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  total_w numeric; passed_w numeric; amt bigint;
begin
  select coalesce(sum(c.weight), 0), coalesce(sum(c.weight) filter (where vr.passed), 0)
    into total_w, passed_w
  from public.verification_results vr join public.criteria c on c.id = vr.criterion_id
  where vr.verification_id = p_verification_id;

  select m.amount_cents into amt
  from public.verifications v join public.milestones m on m.id = v.milestone_id
  where v.id = p_verification_id;

  update public.verifications
     set score_percent  = case when total_w = 0 then 0 else round(100 * passed_w / total_w, 2) end,
         proposed_cents = case when total_w = 0 then 0 else floor(amt * passed_w / total_w) end
   where id = p_verification_id;
end $$;

-- -----------------------------------------------------------------------------
-- RPC: create a project with its milestone plan (client)
--   p_milestones = [
--     { "title": "...", "description": "...", "percent": 30, "due_date": "2026-12-01",
--       "criteria": [ { "type": "CI_PASSES", "description": "...", "weight": 50, "config": {} } ] }
--   ]
-- -----------------------------------------------------------------------------
create or replace function public.create_project(
  p_title text, p_brief text, p_budget_cents bigint, p_freelancer_id uuid, p_milestones jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  pid uuid; mid uuid;
  m jsonb; c jsonb;
  i int := 0; j int;
  pct_total numeric := 0; w_total int;
  allocated bigint := 0; amt bigint; n int;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if not exists (select 1 from public.profiles where id = me and role = 'client') then
    raise exception 'Only client accounts can create projects';
  end if;
  if not exists (select 1 from public.profiles where id = p_freelancer_id and role = 'freelancer') then
    raise exception 'Choose a registered freelancer';
  end if;
  if jsonb_typeof(p_milestones) <> 'array' then raise exception 'Milestones must be a list'; end if;
  n := jsonb_array_length(p_milestones);
  if n < 1 or n > 8 then raise exception 'A plan needs between 1 and 8 milestones'; end if;

  for m in select * from jsonb_array_elements(p_milestones) loop
    pct_total := pct_total + (m->>'percent')::numeric;
    if jsonb_typeof(m->'criteria') <> 'array' or jsonb_array_length(m->'criteria') = 0 then
      raise exception 'Every milestone needs at least one acceptance criterion';
    end if;
    select coalesce(sum((x.value->>'weight')::int), 0) into w_total from jsonb_array_elements(m->'criteria') as x(value);
    if w_total <> 100 then raise exception 'Criteria weights in "%" must total 100%% (got %)', m->>'title', w_total; end if;
  end loop;
  if pct_total <> 100 then raise exception 'Milestone percentages must total 100%% (got %)', pct_total; end if;

  insert into public.projects (client_id, freelancer_id, title, brief, budget_cents)
  values (me, p_freelancer_id, trim(p_title), trim(p_brief), p_budget_cents)
  returning id into pid;

  for m in select * from jsonb_array_elements(p_milestones) loop
    i := i + 1;
    if i = n then amt := p_budget_cents - allocated;
    else amt := floor(p_budget_cents * (m->>'percent')::numeric / 100); end if;
    allocated := allocated + amt;

    insert into public.milestones (project_id, position, title, description, percent, amount_cents, due_date)
    values (pid, i, trim(m->>'title'), coalesce(m->>'description', ''), (m->>'percent')::numeric, amt,
            nullif(m->>'due_date', '')::date)
    returning id into mid;

    j := 0;
    for c in select * from jsonb_array_elements(m->'criteria') loop
      j := j + 1;
      insert into public.criteria (milestone_id, position, type, description, weight, config)
      values (mid, j, (c->>'type')::public.criterion_type, trim(c->>'description'), (c->>'weight')::int,
              coalesce(c->'config', '{}'::jsonb));
    end loop;
  end loop;

  perform public.log_activity(pid, 'project_created', 'Project created with ' || n || ' milestones.');
  return pid;
end $$;

-- -----------------------------------------------------------------------------
-- RPC: authorize funding (client) — simulated PayPal Sandbox authorization
-- -----------------------------------------------------------------------------
create or replace function public.authorize_project(p_project_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare p public.projects; ref text;
begin
  select * into p from public.projects where id = p_project_id for update;
  if p.id is null or p.client_id <> auth.uid() then raise exception 'Project not found'; end if;
  if p.status <> 'draft' then raise exception 'This project is already funded'; end if;

  ref := public.sandbox_ref('AUTH');
  update public.projects set status = 'in_progress', paypal_authorization_id = ref, authorized_at = now()
   where id = p.id;
  update public.milestones set status = 'in_progress' where project_id = p.id and position = 1;
  insert into public.payments (project_id, kind, amount_cents, reference) values (p.id, 'authorization', p.budget_cents, ref);
  perform public.log_activity(p.id, 'authorized', 'Funding authorized in PayPal Sandbox (' || ref || ').');
  return ref;
end $$;

-- -----------------------------------------------------------------------------
-- RPC: submit a milestone (freelancer)
--   p_results = [ { "criterion_id": "...", "passed": true, "evidence": "..." } ]
--   Results for MANUAL_REVIEW criteria are ignored and left for the client.
-- -----------------------------------------------------------------------------
create or replace function public.submit_milestone(
  p_milestone_id uuid, p_repo_url text, p_commit_sha text, p_notes text, p_results jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  ms public.milestones; pr public.projects;
  sid uuid; vid uuid; c public.criteria; r jsonb;
begin
  select * into ms from public.milestones where id = p_milestone_id for update;
  select * into pr from public.projects where id = ms.project_id;
  if ms.id is null or pr.freelancer_id is distinct from auth.uid() then raise exception 'Milestone not found'; end if;
  if pr.status <> 'in_progress' then raise exception 'This project is not active'; end if;
  if ms.status not in ('in_progress', 'revision_requested') then
    raise exception 'This milestone is not open for submission';
  end if;
  if p_repo_url !~* '^https://github\.com/[^/]+/[^/]+' then raise exception 'Enter a GitHub repository URL'; end if;

  insert into public.submissions (milestone_id, freelancer_id, repo_url, commit_sha, notes)
  values (ms.id, auth.uid(), p_repo_url, nullif(p_commit_sha, ''), coalesce(p_notes, ''))
  returning id into sid;

  update public.verifications set status = 'superseded' where milestone_id = ms.id and status = 'pending_review';

  insert into public.verifications (submission_id, milestone_id) values (sid, ms.id) returning id into vid;

  for c in select * from public.criteria where milestone_id = ms.id loop
    r := null;
    select x.value into r from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) as x(value) where x.value->>'criterion_id' = c.id::text limit 1;
    if c.type = 'MANUAL_REVIEW' then
      insert into public.verification_results (verification_id, criterion_id, passed, evidence, source)
      values (vid, c.id, null, 'Awaiting client review.', 'manual');
    else
      insert into public.verification_results (verification_id, criterion_id, passed, evidence, source)
      values (vid, c.id, coalesce((r->>'passed')::boolean, false),
              left(coalesce(r->>'evidence', 'No evidence recorded.'), 1000), 'github');
    end if;
  end loop;

  perform public.recompute_verification(vid);
  update public.milestones set status = 'submitted' where id = ms.id;
  update public.revisions set resolved_at = now() where milestone_id = ms.id and resolved_at is null;
  perform public.log_activity(pr.id, 'submitted', 'Milestone ' || ms.position || ' submitted for verification.');
  return vid;
end $$;

-- -----------------------------------------------------------------------------
-- RPC: client marks a MANUAL_REVIEW criterion as passed / failed
-- -----------------------------------------------------------------------------
create or replace function public.set_manual_result(
  p_verification_id uuid, p_criterion_id uuid, p_passed boolean, p_note text default ''
) returns void
language plpgsql security definer set search_path = public as $$
declare v public.verifications; pr public.projects; ctype public.criterion_type;
begin
  select * into v from public.verifications where id = p_verification_id for update;
  select p.* into pr from public.projects p join public.milestones m on m.project_id = p.id where m.id = v.milestone_id;
  if v.id is null or pr.client_id <> auth.uid() then raise exception 'Verification not found'; end if;
  if v.status <> 'pending_review' then raise exception 'This verification is already decided'; end if;
  select type into ctype from public.criteria where id = p_criterion_id and milestone_id = v.milestone_id;
  if ctype is distinct from 'MANUAL_REVIEW' then raise exception 'Only client-review criteria can be set manually'; end if;

  update public.verification_results
     set passed = p_passed,
         evidence = case when coalesce(trim(p_note), '') = '' then
                      case when p_passed then 'Marked as passed by the client.' else 'Marked as not passed by the client.' end
                    else left(trim(p_note), 1000) end
   where verification_id = v.id and criterion_id = p_criterion_id;
  perform public.recompute_verification(v.id);
end $$;

-- -----------------------------------------------------------------------------
-- RPC: approve the proposed release (client) — simulated capture
-- -----------------------------------------------------------------------------
create or replace function public.approve_release(p_verification_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v public.verifications; ms public.milestones; pr public.projects;
  ref text; captured bigint; nxt uuid; pending int;
begin
  select * into v from public.verifications where id = p_verification_id for update;
  select * into ms from public.milestones where id = v.milestone_id for update;
  select * into pr from public.projects where id = ms.project_id for update;
  if v.id is null or pr.client_id <> auth.uid() then raise exception 'Verification not found'; end if;
  if v.status <> 'pending_review' then raise exception 'This verification is already decided'; end if;
  select count(*) into pending from public.verification_results where verification_id = v.id and passed is null;
  if pending > 0 then raise exception 'Review the remaining client-review criteria first'; end if;
  if v.proposed_cents <= 0 then raise exception 'No criteria passed, so there is nothing to release. Request a revision instead.'; end if;

  select coalesce(sum(amount_cents), 0) into captured from public.payments where project_id = pr.id and kind = 'capture';
  if captured + v.proposed_cents > pr.budget_cents then raise exception 'Release exceeds the remaining authorization'; end if;

  ref := public.sandbox_ref('CAP');
  insert into public.payments (project_id, milestone_id, kind, amount_cents, reference)
  values (pr.id, ms.id, 'capture', v.proposed_cents, ref);

  update public.verifications set status = 'approved', decided_at = now() where id = v.id;
  update public.milestones set status = 'approved', captured_cents = v.proposed_cents, approved_at = now() where id = ms.id;

  select id into nxt from public.milestones where project_id = pr.id and position = ms.position + 1;
  if nxt is not null then
    update public.milestones set status = 'in_progress' where id = nxt;
  else
    update public.projects set status = 'completed', completed_at = now() where id = pr.id;
    select coalesce(sum(amount_cents), 0) into captured from public.payments where project_id = pr.id and kind = 'capture';
    if pr.budget_cents - captured > 0 then
      insert into public.payments (project_id, kind, amount_cents, reference)
      values (pr.id, 'release', pr.budget_cents - captured, public.sandbox_ref('VOID'));
    end if;
    perform public.log_activity(pr.id, 'completed', 'Project completed. Remaining authorization released.');
  end if;

  perform public.log_activity(pr.id, 'captured',
    'Milestone ' || ms.position || ' approved; $' || to_char(v.proposed_cents / 100.0, 'FM999,999,990.00') || ' captured (' || ref || ').');
  return ref;
end $$;

-- -----------------------------------------------------------------------------
-- RPC: request a revision (client)
-- -----------------------------------------------------------------------------
create or replace function public.request_revision(p_verification_id uuid, p_message text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.verifications; ms public.milestones; pr public.projects;
begin
  select * into v from public.verifications where id = p_verification_id for update;
  select * into ms from public.milestones where id = v.milestone_id for update;
  select * into pr from public.projects where id = ms.project_id;
  if v.id is null or pr.client_id <> auth.uid() then raise exception 'Verification not found'; end if;
  if v.status <> 'pending_review' then raise exception 'This verification is already decided'; end if;
  if char_length(coalesce(trim(p_message), '')) < 5 then raise exception 'Describe what needs to change'; end if;

  update public.verifications set status = 'revision_requested', decided_at = now() where id = v.id;
  update public.milestones set status = 'revision_requested' where id = ms.id;
  insert into public.revisions (milestone_id, verification_id, client_id, message)
  values (ms.id, v.id, auth.uid(), trim(p_message));
  perform public.log_activity(pr.id, 'revision', 'Revision requested on milestone ' || ms.position || '.');
end $$;

-- -----------------------------------------------------------------------------
-- RPC: review a freelancer (client, only after at least one capture)
-- -----------------------------------------------------------------------------
create or replace function public.submit_review(p_project_id uuid, p_rating int, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare pr public.projects; rid uuid;
begin
  select * into pr from public.projects where id = p_project_id;
  if pr.id is null or pr.client_id <> auth.uid() then raise exception 'Project not found'; end if;
  if pr.freelancer_id is null then raise exception 'This project has no freelancer'; end if;
  if not exists (select 1 from public.payments where project_id = pr.id and kind = 'capture') then
    raise exception 'Reviews open after the first payment is captured';
  end if;
  insert into public.reviews (project_id, client_id, freelancer_id, rating, body)
  values (pr.id, auth.uid(), pr.freelancer_id, p_rating, trim(p_body))
  returning id into rid;
  perform public.log_activity(pr.id, 'review', 'Client left a ' || p_rating || '-star review.');
  return rid;
exception when unique_violation then
  raise exception 'You have already reviewed this project';
end $$;

-- -----------------------------------------------------------------------------
-- RPC: cancel a draft project (client)
-- -----------------------------------------------------------------------------
create or replace function public.cancel_project(p_project_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pr public.projects; captured bigint;
begin
  select * into pr from public.projects where id = p_project_id for update;
  if pr.id is null or pr.client_id <> auth.uid() then raise exception 'Project not found'; end if;
  if pr.status in ('completed', 'cancelled') then raise exception 'This project is already closed'; end if;
  update public.projects set status = 'cancelled' where id = pr.id;
  if pr.status = 'in_progress' then
    select coalesce(sum(amount_cents), 0) into captured from public.payments where project_id = pr.id and kind = 'capture';
    if pr.budget_cents - captured > 0 then
      insert into public.payments (project_id, kind, amount_cents, reference)
      values (pr.id, 'release', pr.budget_cents - captured, public.sandbox_ref('VOID'));
    end if;
  end if;
  perform public.log_activity(pr.id, 'cancelled', 'Project cancelled by the client.');
end $$;

-- Function grants: signed-in users only.
revoke execute on function public.create_project(text, text, bigint, uuid, jsonb) from public, anon;
revoke execute on function public.authorize_project(uuid) from public, anon;
revoke execute on function public.submit_milestone(uuid, text, text, text, jsonb) from public, anon;
revoke execute on function public.set_manual_result(uuid, uuid, boolean, text) from public, anon;
revoke execute on function public.approve_release(uuid) from public, anon;
revoke execute on function public.request_revision(uuid, text) from public, anon;
revoke execute on function public.submit_review(uuid, int, text) from public, anon;
revoke execute on function public.cancel_project(uuid) from public, anon;
revoke execute on function public.recompute_verification(uuid) from public, anon, authenticated;
revoke execute on function public.log_activity(uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_project(text, text, bigint, uuid, jsonb) to authenticated;
grant execute on function public.authorize_project(uuid) to authenticated;
grant execute on function public.submit_milestone(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.set_manual_result(uuid, uuid, boolean, text) to authenticated;
grant execute on function public.approve_release(uuid) to authenticated;
grant execute on function public.request_revision(uuid, text) to authenticated;
grant execute on function public.submit_review(uuid, int, text) to authenticated;
grant execute on function public.cancel_project(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Storage: resumes bucket (private; files live at <user id>/<file name>)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('resumes', 'resumes', false, 1572864,
        array['application/pdf', 'application/msword',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "resumes: owner upload" on storage.objects;
create policy "resumes: owner upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "resumes: owner update" on storage.objects;
create policy "resumes: owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "resumes: owner delete" on storage.objects;
create policy "resumes: owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "resumes: signed-in read" on storage.objects;
create policy "resumes: signed-in read" on storage.objects
  for select to authenticated
  using (bucket_id = 'resumes');
