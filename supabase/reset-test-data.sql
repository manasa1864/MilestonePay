-- =============================================================================
-- MilestonePay: wipe test data  ⚠ DESTRUCTIVE
--
-- Deletes EVERY user account and everything that belongs to them, so you can sign
-- up again with the same email addresses. Use it on a test project only.
-- Supabase SQL Editor → New query → paste → Run.
--
-- What goes (automatically, through the schema's cascade rules):
--   auth.users, sessions and identities, profiles (including resume text and skills),
--   projects, milestones, criteria, submissions, verifications, revisions, payments,
--   reviews, activity.
-- What stays:
--   the database structure, app_settings (your PayPal / GitHub switches) and the
--   deployed Edge Functions. Uploaded resume FILES also stay in Storage because
--   Supabase doesn't allow deleting them from SQL; empty the "resumes" bucket
--   under Storage if you want them gone.
--
-- Only want to remove ONE person? Don't run this file. Use the block at the bottom.
-- =============================================================================

-- 1) What is about to be deleted:
select
  (select count(*) from auth.users)      as users,
  (select count(*) from public.profiles) as profiles,
  (select count(*) from public.projects) as projects,
  (select count(*) from public.payments) as payments;

-- 2) Delete everything.
delete from auth.users;

-- 3) Check it worked (all zeros):
select
  (select count(*) from auth.users)      as users,
  (select count(*) from public.profiles) as profiles,
  (select count(*) from public.projects) as projects,
  (select count(*) from public.payments) as payments;

-- -----------------------------------------------------------------------------
-- Just one person? Delete the lines above and run only this, with their email:
--
--   delete from auth.users where email = 'person@example.com';
-- -----------------------------------------------------------------------------
