-- =============================================================================
-- MilestonePay — full Supabase schema
--
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- It is idempotent: re-running recreates functions/policies/views and only
-- adds tables/columns that do not exist yet.
--
-- What it sets up
--   • app_settings         switches for real PayPal Sandbox and server-side GitHub checks
--   • profiles             one row per auth user (client or freelancer)
--   • projects             a client's project, assigned to one freelancer, with a late-delivery policy
--   • milestones           priced, ordered deliverables with optional due dates
--   • criteria             weighted acceptance criteria for each milestone
--   • submissions          a freelancer's repository submission for a milestone
--   • verifications        the scored result of a submission (incl. late penalty)
--   • verification_results per-criterion pass/fail + evidence
--   • revisions            client revision requests
--   • payments             authorizations / captures / releases / payouts
--   • reviews              client reviews of freelancers (only after a capture)
--   • activity             project activity feed
--   • search_freelancers(): keyword search over profiles and resume text (no money in the results)
--   • storage bucket `resumes` (private, readable by signed-in users)
--
-- Release amount
--   base     = milestone amount × (weight of passed criteria ÷ total weight)
--   days_late = submission date − milestone due date (0 if on time or no due date)
--   penalty% = min(project.late_penalty_cap, days_late × project.late_penalty_per_day)
--   release  = base × (1 − penalty%)
--
-- Security model
--   Row Level Security is on for every table. Users only read rows for projects
--   they belong to. Every state change goes through a SECURITY DEFINER function
--   that checks the caller's role and the current state. Functions named svc_*
--   can only be called with the service-role key (i.e. from the Edge Functions
--   in supabase/functions), which is how real PayPal and GitHub results get in.
-- =============================================================================

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
  create type public.verification_status as enum ('pending_review', 'processing', 'approved', 'revision_requested', 'superseded');
exception when duplicate_object then null; end $$;
alter type public.verification_status add value if not exists 'processing';

do $$ begin
  create type public.payment_kind as enum ('authorization', 'capture', 'release', 'payout');
exception when duplicate_object then null; end $$;
alter type public.payment_kind add value if not exists 'payout';

-- -----------------------------------------------------------------------------
-- Settings (single row). Flip these after deploying the Edge Functions:
--   update public.app_settings set paypal_enabled = true;        -- real PayPal Sandbox
--   update public.app_settings set server_github_checks = true;  -- GitHub checks on the server
-- -----------------------------------------------------------------------------
create table if not exists public.app_settings (
  id                    boolean primary key default true check (id),
  paypal_enabled        boolean not null default false,
  server_github_checks  boolean not null default false,
  currency              text not null default 'USD'
);
insert into public.app_settings (id) values (true) on conflict (id) do nothing;

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
  paypal_email     text not null default '',   -- freelancer: where payouts are sent
  resume_path      text,                        -- object key inside the `resumes` bucket
  resume_name      text,
  resume_size      integer,
  resume_text      text not null default '',   -- text read from the resume in the browser, used for client search
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint profiles_bio_len check (char_length(bio) <= 1000),
  constraint profiles_headline_len check (char_length(headline) <= 120),
  constraint profiles_portfolio_http check (portfolio_url = '' or portfolio_url ~* '^https?://')
);
alter table public.profiles add column if not exists paypal_email text not null default '';
alter table public.profiles add column if not exists resume_text text not null default '';
do $$ begin
  alter table public.profiles add constraint profiles_resume_text_len check (char_length(resume_text) <= 20000);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.profiles add constraint profiles_paypal_email check (paypal_email = '' or paypal_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
exception when duplicate_object then null; end $$;

create table if not exists public.projects (
  id                        uuid primary key default gen_random_uuid(),
  client_id                 uuid not null references public.profiles (id) on delete cascade,
  freelancer_id             uuid references public.profiles (id) on delete set null,
  title                     text not null check (char_length(title) between 3 and 140),
  brief                     text not null check (char_length(brief) between 20 and 4000),
  budget_cents              bigint not null check (budget_cents > 0 and budget_cents <= 100000000),
  currency                  text not null default 'USD',
  status                    public.project_status not null default 'draft',
  late_penalty_per_day      numeric(5,2) not null default 0 check (late_penalty_per_day between 0 and 100),
  late_penalty_cap          numeric(5,2) not null default 0 check (late_penalty_cap between 0 and 100),
  payment_mode              text not null default 'simulated' check (payment_mode in ('simulated', 'paypal')),
  paypal_order_id           text,
  paypal_authorization_id   text,
  authorization_expires_at  timestamptz,
  authorized_at             timestamptz,
  completed_at              timestamptz,
  created_at                timestamptz not null default now()
);
alter table public.projects add column if not exists late_penalty_per_day numeric(5,2) not null default 0;
alter table public.projects add column if not exists late_penalty_cap numeric(5,2) not null default 0;
alter table public.projects add column if not exists payment_mode text not null default 'simulated';
alter table public.projects add column if not exists paypal_order_id text;
alter table public.projects add column if not exists authorization_expires_at timestamptz;
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
  checked_by     text not null default 'browser' check (checked_by in ('browser', 'server')),
  created_at     timestamptz not null default now()
);
alter table public.submissions add column if not exists checked_by text not null default 'browser';
create index if not exists submissions_milestone_idx on public.submissions (milestone_id);

create table if not exists public.verifications (
  id               uuid primary key default gen_random_uuid(),
  submission_id    uuid not null references public.submissions (id) on delete cascade,
  milestone_id     uuid not null references public.milestones (id) on delete cascade,
  score_percent    numeric(5,2) not null default 0,
  base_cents       bigint not null default 0,      -- before late penalty
  days_late        integer not null default 0,
  penalty_percent  numeric(5,2) not null default 0,
  proposed_cents   bigint not null default 0,      -- after late penalty
  status           public.verification_status not null default 'pending_review',
  created_at       timestamptz not null default now(),
  decided_at       timestamptz
);
alter table public.verifications add column if not exists base_cents bigint not null default 0;
alter table public.verifications add column if not exists days_late integer not null default 0;
alter table public.verifications add column if not exists penalty_percent numeric(5,2) not null default 0;
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
  note          text not null default '',
  created_at    timestamptz not null default now()
);
alter table public.payments add column if not exists note text not null default '';
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
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  r text := meta->>'role';
  url text := coalesce(meta->>'portfolio_url', '');
  pp text := lower(trim(coalesce(meta->>'paypal_email', '')));
begin
  if url <> '' and url !~* '^https?://' then url := ''; end if;
  if pp <> '' and pp !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then pp := ''; end if;
  insert into public.profiles (id, role, full_name, email, company, headline, bio, skills, portfolio_url, github_username, paypal_email)
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
    left(coalesce(meta->>'github_username', ''), 60),
    pp
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
alter table public.app_settings         enable row level security;
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

revoke all on public.app_settings, public.profiles, public.projects, public.milestones, public.criteria,
              public.submissions, public.verifications, public.verification_results, public.revisions,
              public.payments, public.reviews, public.activity from anon;
grant select on public.app_settings, public.profiles, public.projects, public.milestones, public.criteria,
                public.submissions, public.verifications, public.verification_results, public.revisions,
                public.payments, public.reviews, public.activity to authenticated;
grant delete on public.projects to authenticated;

drop policy if exists "app_settings: signed-in read" on public.app_settings;
create policy "app_settings: signed-in read" on public.app_settings
  for select to authenticated using (true);

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles
  for select to authenticated using (id = auth.uid());

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Only these columns are editable by the user (role and email are not).
revoke update on public.profiles from authenticated;
grant update (full_name, company, headline, bio, skills, portfolio_url, github_username, paypal_email,
              resume_path, resume_name, resume_size, resume_text) on public.profiles to authenticated;

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

-- No money anywhere in the public stats: clients browsing profiles never see earnings.
create view public.freelancer_stats as
  select
    pr.id as freelancer_id,
    (select count(*) from public.milestones m join public.projects p on p.id = m.project_id
       where p.freelancer_id = pr.id and m.status = 'approved')                         as verified_milestones,
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
-- Old signatures from earlier versions of this file
-- -----------------------------------------------------------------------------
drop function if exists public.log_activity(uuid, text, text);
drop function if exists public.create_project(text, text, bigint, uuid, jsonb);
drop function if exists public.update_draft_project(uuid, text, text, bigint, uuid, jsonb);

-- -----------------------------------------------------------------------------
-- Internal helpers (not callable by users)
-- -----------------------------------------------------------------------------
create or replace function public.sandbox_ref(prefix text)
returns text language sql volatile as $$
  select prefix || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
$$;

create or replace function public.money_text(cents bigint)
returns text language sql immutable as $$
  select '$' || to_char(cents / 100.0, 'FM999,999,990.00');
$$;

create or replace function public.log_activity(p_project uuid, p_actor uuid, p_kind text, p_message text)
returns void language sql security definer set search_path = public as $$
  insert into public.activity (project_id, actor_id, kind, message) values (p_project, p_actor, p_kind, p_message);
$$;

create or replace function public.setting_paypal() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select paypal_enabled from public.app_settings where id), false);
$$;

create or replace function public.setting_server_checks() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select server_github_checks from public.app_settings where id), false);
$$;

-- Score, late penalty and proposed release for a verification.
create or replace function public.recompute_verification(p_verification_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  total_w numeric; passed_w numeric; amt bigint; due date; submitted date;
  rate numeric; cap numeric; late int := 0; pen numeric := 0; base bigint;
begin
  select coalesce(sum(c.weight), 0), coalesce(sum(c.weight) filter (where vr.passed), 0)
    into total_w, passed_w
  from public.verification_results vr join public.criteria c on c.id = vr.criterion_id
  where vr.verification_id = p_verification_id;

  select m.amount_cents, m.due_date, (s.created_at at time zone 'utc')::date, p.late_penalty_per_day, p.late_penalty_cap
    into amt, due, submitted, rate, cap
  from public.verifications v
  join public.milestones m on m.id = v.milestone_id
  join public.projects p on p.id = m.project_id
  join public.submissions s on s.id = v.submission_id
  where v.id = p_verification_id;

  if due is not null and submitted > due then late := submitted - due; end if;
  pen := least(cap, rate * late);
  base := case when total_w = 0 then 0 else floor(amt * passed_w / total_w) end;

  update public.verifications
     set score_percent   = case when total_w = 0 then 0 else round(100 * passed_w / total_w, 2) end,
         base_cents      = base,
         days_late       = late,
         penalty_percent = pen,
         proposed_cents  = floor(base * (100 - pen) / 100)
   where id = p_verification_id;
end $$;

-- Validate a milestone plan and write it for a project.
--   p_milestones = [ { "title", "description", "percent", "due_date",
--                      "criteria": [ { "type", "description", "weight", "config" } ] } ]
create or replace function public.write_plan(p_project_id uuid, p_budget_cents bigint, p_milestones jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  mid uuid; m jsonb; c jsonb;
  i int := 0; j int; n int;
  pct_total numeric := 0; w_total int;
  allocated bigint := 0; amt bigint;
begin
  if jsonb_typeof(p_milestones) <> 'array' then raise exception 'Milestones must be a list'; end if;
  n := jsonb_array_length(p_milestones);
  if n < 1 or n > 8 then raise exception 'A plan needs between 1 and 8 milestones'; end if;

  for m in select * from jsonb_array_elements(p_milestones) loop
    pct_total := pct_total + (m->>'percent')::numeric;
    if char_length(trim(coalesce(m->>'title', ''))) < 2 then raise exception 'Every milestone needs a title'; end if;
    if jsonb_typeof(m->'criteria') <> 'array' or jsonb_array_length(m->'criteria') = 0 then
      raise exception 'Every milestone needs at least one acceptance criterion';
    end if;
    select coalesce(sum((x.value->>'weight')::int), 0) into w_total from jsonb_array_elements(m->'criteria') as x(value);
    if w_total <> 100 then raise exception 'Criteria weights in "%" must total 100%% (got %)', m->>'title', w_total; end if;
  end loop;
  if pct_total <> 100 then raise exception 'Milestone percentages must total 100%% (got %)', pct_total; end if;

  for m in select * from jsonb_array_elements(p_milestones) loop
    i := i + 1;
    if i = n then amt := p_budget_cents - allocated;
    else amt := floor(p_budget_cents * (m->>'percent')::numeric / 100); end if;
    allocated := allocated + amt;

    insert into public.milestones (project_id, position, title, description, percent, amount_cents, due_date)
    values (p_project_id, i, trim(m->>'title'), coalesce(m->>'description', ''), (m->>'percent')::numeric, amt,
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
  return n;
end $$;

-- Mark a draft project as funded (shared by simulated and PayPal flows).
create or replace function public.mp_fund(p_actor uuid, p_project_id uuid, p_mode text, p_ref text, p_order_id text, p_expires timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare p public.projects;
begin
  select * into p from public.projects where id = p_project_id for update;
  if p.id is null or p.client_id is distinct from p_actor then raise exception 'Project not found'; end if;
  if p.status <> 'draft' then raise exception 'This project is already funded'; end if;

  update public.projects
     set status = 'in_progress', payment_mode = p_mode, paypal_authorization_id = p_ref,
         paypal_order_id = coalesce(p_order_id, paypal_order_id), authorization_expires_at = p_expires, authorized_at = now()
   where id = p.id;
  update public.milestones set status = 'in_progress' where project_id = p.id and position = 1;
  insert into public.payments (project_id, kind, amount_cents, reference, note)
  values (p.id, 'authorization', p.budget_cents, p_ref, case when p_mode = 'paypal' then 'PayPal Sandbox' else 'Simulated' end);
  perform public.log_activity(p.id, p_actor, 'authorized',
    case when p_mode = 'paypal' then 'Funding authorized in PayPal Sandbox (' else 'Funding authorized (simulated, ' end || p_ref || ').');
end $$;

-- Create a submission + verification from check results.
create or replace function public.mp_submit(
  p_actor uuid, p_milestone_id uuid, p_repo_url text, p_commit_sha text, p_notes text, p_results jsonb, p_checked_by text
) returns uuid language plpgsql security definer set search_path = public as $$
declare ms public.milestones; pr public.projects; sid uuid; vid uuid; c public.criteria; r jsonb;
begin
  select * into ms from public.milestones where id = p_milestone_id for update;
  select * into pr from public.projects where id = ms.project_id;
  if ms.id is null or pr.freelancer_id is distinct from p_actor then raise exception 'Milestone not found'; end if;
  if pr.status <> 'in_progress' then raise exception 'This project is not active'; end if;
  if ms.status not in ('in_progress', 'revision_requested') then raise exception 'This milestone is not open for submission'; end if;
  if p_repo_url !~* '^https://github\.com/[^/]+/[^/]+' then raise exception 'Enter a GitHub repository URL'; end if;

  insert into public.submissions (milestone_id, freelancer_id, repo_url, commit_sha, notes, checked_by)
  values (ms.id, p_actor, p_repo_url, nullif(p_commit_sha, ''), coalesce(p_notes, ''), p_checked_by)
  returning id into sid;

  update public.verifications set status = 'superseded' where milestone_id = ms.id and status = 'pending_review';
  insert into public.verifications (submission_id, milestone_id) values (sid, ms.id) returning id into vid;

  for c in select * from public.criteria where milestone_id = ms.id loop
    r := null;
    select x.value into r from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) as x(value)
     where x.value->>'criterion_id' = c.id::text limit 1;
    if c.type = 'MANUAL_REVIEW' then
      insert into public.verification_results (verification_id, criterion_id, passed, evidence, source)
      values (vid, c.id, null, 'Awaiting client review.', 'manual');
    else
      insert into public.verification_results (verification_id, criterion_id, passed, evidence, source)
      values (vid, c.id, coalesce((r->>'passed')::boolean, false), left(coalesce(r->>'evidence', 'No evidence recorded.'), 1000), 'github');
    end if;
  end loop;

  perform public.recompute_verification(vid);
  update public.milestones set status = 'submitted' where id = ms.id;
  update public.revisions set resolved_at = now() where milestone_id = ms.id and resolved_at is null;
  perform public.log_activity(pr.id, p_actor, 'submitted', 'Milestone ' || ms.position || ' submitted for verification.');
  return vid;
end $$;

-- Validate that a verification can be released by this client.
create or replace function public.mp_release_check(p_actor uuid, p_verification_id uuid, p_allowed text[])
returns void language plpgsql security definer set search_path = public as $$
declare v public.verifications; pr public.projects; pending int; captured bigint;
begin
  select * into v from public.verifications where id = p_verification_id;
  select p.* into pr from public.projects p join public.milestones m on m.project_id = p.id where m.id = v.milestone_id;
  if v.id is null or pr.client_id is distinct from p_actor then raise exception 'Verification not found'; end if;
  if not (v.status::text = any (p_allowed)) then
    raise exception '%', case when v.status = 'processing' then 'This release is already being processed' else 'This verification is already decided' end;
  end if;
  if pr.status <> 'in_progress' then raise exception 'This project is not active'; end if;
  select count(*) into pending from public.verification_results where verification_id = v.id and passed is null;
  if pending > 0 then raise exception 'Review the remaining client-review criteria first'; end if;
  if v.proposed_cents <= 0 then raise exception 'Nothing to release for this submission. Request a revision instead.'; end if;
  select coalesce(sum(amount_cents), 0) into captured from public.payments where project_id = pr.id and kind = 'capture';
  if captured + v.proposed_cents > pr.budget_cents then raise exception 'Release exceeds the remaining authorization'; end if;
end $$;

-- Record a release after the money has moved (or been simulated).
create or replace function public.mp_apply_release(p_actor uuid, p_verification_id uuid, p_ref text, p_release_ref text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.verifications; ms public.milestones; pr public.projects; captured bigint; nxt uuid; late text := '';
begin
  select * into v from public.verifications where id = p_verification_id for update;
  select * into ms from public.milestones where id = v.milestone_id for update;
  select * into pr from public.projects where id = ms.project_id for update;

  insert into public.payments (project_id, milestone_id, kind, amount_cents, reference, note)
  values (pr.id, ms.id, 'capture', v.proposed_cents, p_ref,
          case when v.penalty_percent > 0 then v.days_late || ' day(s) late, −' || v.penalty_percent || '%' else '' end);
  update public.verifications set status = 'approved', decided_at = now() where id = v.id;
  update public.milestones set status = 'approved', captured_cents = v.proposed_cents, approved_at = now() where id = ms.id;

  select id into nxt from public.milestones where project_id = pr.id and position = ms.position + 1;
  if nxt is not null then
    update public.milestones set status = 'in_progress' where id = nxt;
  else
    update public.projects set status = 'completed', completed_at = now() where id = pr.id;
    select coalesce(sum(amount_cents), 0) into captured from public.payments where project_id = pr.id and kind = 'capture';
    if pr.budget_cents - captured > 0 then
      insert into public.payments (project_id, kind, amount_cents, reference, note)
      values (pr.id, 'release', pr.budget_cents - captured, p_release_ref, 'Unused authorization released');
    end if;
    perform public.log_activity(pr.id, p_actor, 'completed', 'Project completed. Remaining authorization released.');
  end if;

  if v.penalty_percent > 0 then late := ' after a ' || v.penalty_percent || '% late penalty'; end if;
  perform public.log_activity(pr.id, p_actor, 'captured',
    'Milestone ' || ms.position || ' approved; ' || public.money_text(v.proposed_cents) || ' captured' || late || ' (' || p_ref || ').');
end $$;

-- Cancel a project and release whatever was not captured.
create or replace function public.mp_cancel(p_actor uuid, p_project_id uuid, p_release_ref text)
returns void language plpgsql security definer set search_path = public as $$
declare pr public.projects; captured bigint;
begin
  select * into pr from public.projects where id = p_project_id for update;
  if pr.id is null or pr.client_id is distinct from p_actor then raise exception 'Project not found'; end if;
  if pr.status in ('completed', 'cancelled') then raise exception 'This project is already closed'; end if;
  if exists (select 1 from public.verifications v join public.milestones m on m.id = v.milestone_id
             where m.project_id = pr.id and v.status = 'processing') then
    raise exception 'A payment is being processed. Try again in a moment.';
  end if;
  update public.projects set status = 'cancelled' where id = pr.id;
  if pr.status = 'in_progress' then
    select coalesce(sum(amount_cents), 0) into captured from public.payments where project_id = pr.id and kind = 'capture';
    if pr.budget_cents - captured > 0 then
      insert into public.payments (project_id, kind, amount_cents, reference, note)
      values (pr.id, 'release', pr.budget_cents - captured, p_release_ref, 'Authorization voided on cancellation');
    end if;
  end if;
  perform public.log_activity(pr.id, p_actor, 'cancelled', 'Project cancelled by the client.');
end $$;

-- -----------------------------------------------------------------------------
-- User RPCs (signed-in users; caller = auth.uid())
-- -----------------------------------------------------------------------------
create or replace function public.create_project(
  p_title text, p_brief text, p_budget_cents bigint, p_freelancer_id uuid, p_milestones jsonb,
  p_late_penalty_per_day numeric default 0, p_late_penalty_cap numeric default 0
) returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pid uuid; n int;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if not exists (select 1 from public.profiles where id = me and role = 'client') then
    raise exception 'Only client accounts can create projects';
  end if;
  if not exists (select 1 from public.profiles where id = p_freelancer_id and role = 'freelancer') then
    raise exception 'Choose a registered freelancer';
  end if;
  insert into public.projects (client_id, freelancer_id, title, brief, budget_cents, late_penalty_per_day, late_penalty_cap,
                               currency)
  values (me, p_freelancer_id, trim(p_title), trim(p_brief), p_budget_cents, coalesce(p_late_penalty_per_day, 0),
          coalesce(p_late_penalty_cap, 0), (select currency from public.app_settings where id))
  returning id into pid;
  n := public.write_plan(pid, p_budget_cents, p_milestones);
  perform public.log_activity(pid, me, 'project_created', 'Project created with ' || n || ' milestones.');
  return pid;
end $$;

create or replace function public.update_draft_project(
  p_project_id uuid, p_title text, p_brief text, p_budget_cents bigint, p_freelancer_id uuid, p_milestones jsonb,
  p_late_penalty_per_day numeric default 0, p_late_penalty_cap numeric default 0
) returns void language plpgsql security definer set search_path = public as $$
declare pr public.projects; n int;
begin
  select * into pr from public.projects where id = p_project_id for update;
  if pr.id is null or pr.client_id <> auth.uid() then raise exception 'Project not found'; end if;
  if pr.status <> 'draft' then raise exception 'Only unfunded projects can be edited'; end if;
  if not exists (select 1 from public.profiles where id = p_freelancer_id and role = 'freelancer') then
    raise exception 'Choose a registered freelancer';
  end if;
  update public.projects
     set title = trim(p_title), brief = trim(p_brief), budget_cents = p_budget_cents, freelancer_id = p_freelancer_id,
         late_penalty_per_day = coalesce(p_late_penalty_per_day, 0), late_penalty_cap = coalesce(p_late_penalty_cap, 0),
         paypal_order_id = null
   where id = pr.id;
  delete from public.milestones where project_id = pr.id;
  n := public.write_plan(pr.id, p_budget_cents, p_milestones);
  perform public.log_activity(pr.id, auth.uid(), 'project_edited', 'Plan updated (' || n || ' milestones).');
end $$;

-- Simulated funding (only when real PayPal is not enabled).
create or replace function public.authorize_project(p_project_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare ref text := public.sandbox_ref('AUTH');
begin
  if public.setting_paypal() then raise exception 'Funding goes through PayPal. Use the PayPal button.'; end if;
  perform public.mp_fund(auth.uid(), p_project_id, 'simulated', ref, null, null);
  return ref;
end $$;

-- Browser-checked submission (only when server-side GitHub checks are off).
create or replace function public.submit_milestone(
  p_milestone_id uuid, p_repo_url text, p_commit_sha text, p_notes text, p_results jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
begin
  if public.setting_server_checks() then raise exception 'Submissions are verified on the server. Refresh the page and try again.'; end if;
  return public.mp_submit(auth.uid(), p_milestone_id, p_repo_url, p_commit_sha, p_notes, p_results, 'browser');
end $$;

create or replace function public.set_manual_result(
  p_verification_id uuid, p_criterion_id uuid, p_passed boolean, p_note text default ''
) returns void language plpgsql security definer set search_path = public as $$
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

-- Simulated release (projects funded in simulated mode).
create or replace function public.approve_release(p_verification_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare mode text; ref text := public.sandbox_ref('CAP');
begin
  select p.payment_mode into mode from public.verifications v join public.milestones m on m.id = v.milestone_id
    join public.projects p on p.id = m.project_id where v.id = p_verification_id;
  if mode = 'paypal' then raise exception 'This project is paid through PayPal. Refresh the page and try again.'; end if;
  perform public.mp_release_check(auth.uid(), p_verification_id, array['pending_review']);
  perform public.mp_apply_release(auth.uid(), p_verification_id, ref, public.sandbox_ref('VOID'));
  return ref;
end $$;

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
  insert into public.revisions (milestone_id, verification_id, client_id, message) values (ms.id, v.id, auth.uid(), trim(p_message));
  perform public.log_activity(pr.id, auth.uid(), 'revision', 'Revision requested on milestone ' || ms.position || '.');
end $$;

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
  values (pr.id, auth.uid(), pr.freelancer_id, p_rating, trim(p_body)) returning id into rid;
  perform public.log_activity(pr.id, auth.uid(), 'review', 'Client left a ' || p_rating || '-star review.');
  return rid;
exception when unique_violation then
  raise exception 'You have already reviewed this project';
end $$;

-- Cancel: drafts always; funded projects only in simulated mode (PayPal goes through the Edge Function).
create or replace function public.cancel_project(p_project_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pr public.projects;
begin
  select * into pr from public.projects where id = p_project_id;
  if pr.status = 'in_progress' and pr.payment_mode = 'paypal' then
    raise exception 'This project is paid through PayPal. Refresh the page and try again.';
  end if;
  perform public.mp_cancel(auth.uid(), p_project_id, public.sandbox_ref('VOID'));
end $$;

create or replace function public.project_contacts()
returns table (user_id uuid, email text)
language sql stable security definer set search_path = public as $$
  select distinct pr.id, pr.email
  from public.projects p
  join public.profiles pr on pr.id in (p.client_id, p.freelancer_id)
  where (p.client_id = auth.uid() or p.freelancer_id = auth.uid()) and pr.id <> auth.uid();
$$;

-- Client search: keywords across name, headline, bio, skills and the text read from resumes.
-- Every keyword must match somewhere; picked skills must all be on the profile.
-- Returns ids, a ranking and a snippet; the app loads the public profiles for those ids.
create or replace function public.search_freelancers(p_query text, p_skills text[] default '{}')
returns table (freelancer_id uuid, score int, matched_in text, snippet text)
language plpgsql stable security definer set search_path = public as $$
declare
  terms text[];
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select coalesce(array_agg(t), '{}') into terms from (
    select distinct lower(x) as t from regexp_split_to_table(coalesce(p_query, ''), '[\s,;]+') as x
    where char_length(x) >= 2 limit 8) q;

  return query
  with base as (
    select pr.id,
           lower(pr.full_name) as nm,
           lower(pr.headline) as hl,
           lower(pr.bio) as bio,
           lower(array_to_string(pr.skills, ' ')) as sk,
           lower(pr.resume_text) as rt,
           pr.resume_text as raw
    from public.profiles pr
    where pr.role = 'freelancer'
      and not exists (
        select 1 from unnest(coalesce(p_skills, '{}')) as want(s)
        where not exists (select 1 from unnest(pr.skills) k where lower(k) = lower(want.s)))
  ), scored as (
    select b.*,
      (select count(*) from unnest(terms) t where position(t in b.nm || ' ' || b.hl || ' ' || b.sk || ' ' || b.bio) > 0)::int as in_profile,
      (select count(*) from unnest(terms) t where position(t in b.rt) > 0)::int as in_resume,
      (select count(*) from unnest(terms) t where position(t in b.sk) > 0)::int * 3
        + (select count(*) from unnest(terms) t where position(t in b.nm || ' ' || b.hl) > 0)::int * 2
        + (select count(*) from unnest(terms) t where position(t in b.bio) > 0)::int
        + (select count(*) from unnest(terms) t where position(t in b.rt) > 0)::int as pts,
      (select min(position(t in b.rt)) from unnest(terms) t where position(t in b.rt) > 0) as first_hit,
      (select t from unnest(terms) t where position(t in b.rt) > 0 order by position(t in b.rt) limit 1) as hit_term
    from base b
  )
  select s.id,
         s.pts,
         case when cardinality(terms) = 0 then 'profile'
              when s.in_profile = cardinality(terms) then 'profile' else 'resume' end,
         case when s.first_hit is null or cardinality(terms) = 0 then ''
              else (case when s.first_hit > 60 then '…' else '' end)
                   || regexp_replace(substr(s.raw, greatest(1, s.first_hit - 60), char_length(s.hit_term) + 120), '\s+', ' ', 'g')
                   || (case when s.first_hit + char_length(s.hit_term) + 60 < char_length(s.raw) then '…' else '' end)
         end
  from scored s
  where cardinality(terms) = 0
     or (select count(*) from unnest(terms) t
         where position(t in s.nm || ' ' || s.hl || ' ' || s.sk || ' ' || s.bio || ' ' || s.rt) > 0) = cardinality(terms)
  order by s.pts desc, s.nm;
end $$;

-- -----------------------------------------------------------------------------
-- Service RPCs (Edge Functions only; caller passed explicitly as p_actor)
-- -----------------------------------------------------------------------------

-- PayPal: details needed to create an order for a draft project.
create or replace function public.svc_paypal_prepare_order(p_actor uuid, p_project_id uuid)
returns table (budget_cents bigint, currency text, title text)
language plpgsql security definer set search_path = public as $$
declare p public.projects;
begin
  if not public.setting_paypal() then raise exception 'PayPal is not enabled'; end if;
  select * into p from public.projects where id = p_project_id;
  if p.id is null or p.client_id is distinct from p_actor then raise exception 'Project not found'; end if;
  if p.status <> 'draft' then raise exception 'This project is already funded'; end if;
  return query select p.budget_cents, p.currency, p.title;
end $$;

create or replace function public.svc_paypal_set_order(p_actor uuid, p_project_id uuid, p_order_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.projects set paypal_order_id = p_order_id
   where id = p_project_id and client_id = p_actor and status = 'draft';
  if not found then raise exception 'Project not found'; end if;
end $$;

-- PayPal: the buyer approved and the order was authorized for the full budget.
create or replace function public.svc_paypal_mark_authorized(
  p_actor uuid, p_project_id uuid, p_order_id text, p_authorization_id text, p_amount_cents bigint, p_expires_at timestamptz
) returns void language plpgsql security definer set search_path = public as $$
declare p public.projects;
begin
  select * into p from public.projects where id = p_project_id;
  if p.id is null or p.client_id is distinct from p_actor then raise exception 'Project not found'; end if;
  if p.paypal_order_id is distinct from p_order_id then raise exception 'PayPal order does not match this project'; end if;
  if p_amount_cents <> p.budget_cents then raise exception 'Authorized amount does not match the project budget'; end if;
  perform public.mp_fund(p_actor, p_project_id, 'paypal', p_authorization_id, p_order_id, p_expires_at);
end $$;

-- PayPal: lock a verification for capture and return what to capture.
-- A verification already in 'processing' can be resumed: the Edge Function reuses the same
-- PayPal-Request-Id, so PayPal returns the original capture instead of charging twice.
create or replace function public.svc_paypal_begin_release(p_actor uuid, p_verification_id uuid)
returns table (authorization_id text, amount_cents bigint, currency text, is_final boolean,
               payee_email text, project_id uuid, milestone_id uuid, milestone_position int, project_title text)
language plpgsql security definer set search_path = public as $$
declare v public.verifications; ms public.milestones; pr public.projects; fl public.profiles;
begin
  perform public.mp_release_check(p_actor, p_verification_id, array['pending_review', 'processing']);
  select * into v from public.verifications where id = p_verification_id for update;
  select * into ms from public.milestones where id = v.milestone_id;
  select * into pr from public.projects where id = ms.project_id;
  if pr.payment_mode <> 'paypal' then raise exception 'This project was not funded through PayPal'; end if;
  select * into fl from public.profiles where id = pr.freelancer_id;
  update public.verifications set status = 'processing' where id = v.id;
  return query select pr.paypal_authorization_id, v.proposed_cents, pr.currency,
    not exists (select 1 from public.milestones where public.milestones.project_id = pr.id and position = ms.position + 1),
    coalesce(fl.paypal_email, ''), pr.id, ms.id, ms.position, pr.title;
end $$;

create or replace function public.svc_paypal_abort_release(p_verification_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.verifications set status = 'pending_review' where id = p_verification_id and status = 'processing';
$$;

create or replace function public.svc_paypal_finish_release(p_actor uuid, p_verification_id uuid, p_capture_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.mp_release_check(p_actor, p_verification_id, array['processing']);
  perform public.mp_apply_release(p_actor, p_verification_id, p_capture_id, 'FINAL-CAPTURE-' || p_capture_id);
end $$;

-- Record a payout to the freelancer. With a null reference, only logs (e.g. payout failed or skipped).
create or replace function public.svc_record_payout(
  p_actor uuid, p_project_id uuid, p_milestone_id uuid, p_amount_cents bigint, p_reference text, p_note text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_reference is not null then
    insert into public.payments (project_id, milestone_id, kind, amount_cents, reference, note)
    values (p_project_id, p_milestone_id, 'payout', p_amount_cents, p_reference, left(coalesce(p_note, ''), 300));
  end if;
  perform public.log_activity(p_project_id, p_actor, 'payout', left(coalesce(p_note, ''), 300));
end $$;

-- What is owed to the freelancer for a captured milestone that has not been paid out yet.
create or replace function public.svc_payout_info(p_actor uuid, p_milestone_id uuid)
returns table (project_id uuid, amount_cents bigint, currency text, payee_email text, milestone_position int, project_title text)
language plpgsql security definer set search_path = public as $$
declare ms public.milestones; pr public.projects; fl public.profiles;
begin
  select * into ms from public.milestones where id = p_milestone_id;
  select * into pr from public.projects where id = ms.project_id;
  if ms.id is null or (pr.client_id is distinct from p_actor and pr.freelancer_id is distinct from p_actor) then
    raise exception 'Milestone not found';
  end if;
  if pr.payment_mode <> 'paypal' then raise exception 'This project was not funded through PayPal'; end if;
  if ms.status <> 'approved' or ms.captured_cents <= 0 then raise exception 'Nothing has been captured for this milestone'; end if;
  if exists (select 1 from public.payments where milestone_id = ms.id and kind = 'payout') then
    raise exception 'This milestone has already been paid out';
  end if;
  select * into fl from public.profiles where id = pr.freelancer_id;
  return query select pr.id, ms.captured_cents, pr.currency, coalesce(fl.paypal_email, ''), ms.position, pr.title;
end $$;

-- PayPal: what to void when a funded project is cancelled.
create or replace function public.svc_paypal_begin_cancel(p_actor uuid, p_project_id uuid)
returns table (authorization_id text, status text, payment_mode text)
language plpgsql security definer set search_path = public as $$
declare p public.projects;
begin
  select * into p from public.projects where id = p_project_id;
  if p.id is null or p.client_id is distinct from p_actor then raise exception 'Project not found'; end if;
  if p.status in ('completed', 'cancelled') then raise exception 'This project is already closed'; end if;
  return query select p.paypal_authorization_id, p.status::text, p.payment_mode;
end $$;

create or replace function public.svc_paypal_finish_cancel(p_actor uuid, p_project_id uuid, p_void_ref text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.mp_cancel(p_actor, p_project_id, p_void_ref);
end $$;

-- GitHub: criteria to check for a milestone (validates the freelancer).
create or replace function public.svc_github_context(p_actor uuid, p_milestone_id uuid)
returns table (criterion_id uuid, type text, description text, weight int, config jsonb)
language plpgsql security definer set search_path = public as $$
declare ms public.milestones; pr public.projects;
begin
  select * into ms from public.milestones where id = p_milestone_id;
  select * into pr from public.projects where id = ms.project_id;
  if ms.id is null or pr.freelancer_id is distinct from p_actor then raise exception 'Milestone not found'; end if;
  if pr.status <> 'in_progress' or ms.status not in ('in_progress', 'revision_requested') then
    raise exception 'This milestone is not open for submission';
  end if;
  return query select c.id, c.type::text, c.description, c.weight, c.config
    from public.criteria c where c.milestone_id = ms.id order by c.position;
end $$;

-- GitHub: submission with results produced by the server.
create or replace function public.svc_github_submit(
  p_actor uuid, p_milestone_id uuid, p_repo_url text, p_commit_sha text, p_notes text, p_results jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
begin
  return public.mp_submit(p_actor, p_milestone_id, p_repo_url, p_commit_sha, p_notes, p_results, 'server');
end $$;

-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------
do $$
declare f record;
begin
  -- Lock down every function in public first.
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f'
             and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- RLS helpers must stay callable by signed-in users.
grant execute on function public.is_project_member(uuid), public.milestone_project(uuid), public.verification_project(uuid)
  to authenticated;

-- User RPCs.
grant execute on function
  public.create_project(text, text, bigint, uuid, jsonb, numeric, numeric),
  public.update_draft_project(uuid, text, text, bigint, uuid, jsonb, numeric, numeric),
  public.authorize_project(uuid),
  public.submit_milestone(uuid, text, text, text, jsonb),
  public.set_manual_result(uuid, uuid, boolean, text),
  public.approve_release(uuid),
  public.request_revision(uuid, text),
  public.submit_review(uuid, int, text),
  public.cancel_project(uuid),
  public.project_contacts(),
  public.search_freelancers(text, text[])
  to authenticated;

-- Service RPCs (Edge Functions use the service-role key).
grant execute on function
  public.svc_paypal_prepare_order(uuid, uuid),
  public.svc_paypal_set_order(uuid, uuid, text),
  public.svc_paypal_mark_authorized(uuid, uuid, text, text, bigint, timestamptz),
  public.svc_paypal_begin_release(uuid, uuid),
  public.svc_paypal_abort_release(uuid),
  public.svc_paypal_finish_release(uuid, uuid, text),
  public.svc_record_payout(uuid, uuid, uuid, bigint, text, text),
  public.svc_payout_info(uuid, uuid),
  public.svc_paypal_begin_cancel(uuid, uuid),
  public.svc_paypal_finish_cancel(uuid, uuid, text),
  public.svc_github_context(uuid, uuid),
  public.svc_github_submit(uuid, uuid, text, text, text, jsonb)
  to service_role;

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
