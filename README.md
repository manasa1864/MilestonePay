# MilestonePay

Milestone-based payments for software projects. Clients define milestones, authorize funds once, and release payment only after GitHub-backed verification passes. Freelancers submit work against clear acceptance criteria and get paid for what verifies.

> Payments are simulated (PayPal Sandbox–style references); no real funds move.

## How it works

1. **Client** creates a project: brief, budget, and a registered freelancer.
2. MilestonePay suggests a 2–5 milestone plan from the brief. The client edits milestones, percentages, due dates and weighted acceptance criteria.
3. Client **authorizes** the full budget. Milestone 01 opens.
4. **Freelancer** submits a public GitHub repository. The browser runs the checks against the latest commit on the default branch:
   - `CI_PASSES`: all GitHub check runs (or the combined status) succeed
   - `FILE_EXISTS`: a configured file path exists
   - `PR_MERGED`: at least one PR is merged into the default branch
   - `MANUAL_REVIEW`: left for the client to judge
5. **Client** reviews the evidence report, marks client-review criteria, then either:
   - **approves**, which captures `milestone amount × passed weight` and opens the next milestone, or
   - **requests a revision** with a message; the freelancer resubmits and all checks rerun.
6. After the final milestone, the project completes and any uncaptured authorization is released. Clients can leave one review per project once a payment is captured.

## Account types

| | Client | Freelancer |
| --- | --- | --- |
| Navigation | Overview, Projects, Payments, Find freelancers | Overview, My work, Earnings, My profile |
| Profile | Company, website, what they hire for | Headline, skills, GitHub, bio, **portfolio website** and **resume** (both optional) |
| Can | Create, fund and cancel projects; approve releases; request revisions; review freelancers | Submit milestones; see verification evidence and revision requests |

## Getting started

```bash
pnpm install        # or npm install
pnpm dev
```

Without Supabase settings the app runs in **local mode**: everything works, but data is stored in this browser only. The sidebar shows which mode is active.

### Connect Supabase

1. Create a Supabase project.
2. In **SQL Editor**, run [`supabase/schema.sql`](supabase/schema.sql). It is safe to run more than once.
3. Copy `.env.example` to `.env` and fill in the values from **Project Settings → API**:

   | Variable | Description |
   | --- | --- |
   | `VITE_SUPABASE_URL` | Project URL |
   | `VITE_SUPABASE_ANON_KEY` | anon / public key |

4. Restart the dev server.

5. Turn off **Confirm email** (Authentication → Sign In / Providers → Email). Anyone can then sign up as a client or freelancer and is logged straight in. Email verification is planned for later.

## What the SQL sets up

- **Tables:** `profiles`, `projects`, `milestones`, `criteria`, `submissions`, `verifications`, `verification_results`, `revisions`, `payments`, `reviews`, `activity`
- **Trigger:** creates a `profiles` row from sign-up metadata (role, name, profile fields)
- **Row Level Security** on every table: users only see projects they are the client or freelancer on. Users can edit only their own profile's editable columns; role and email are locked.
- **RPC functions** for every state change, each checking role and current state: `create_project`, `authorize_project`, `submit_milestone`, `set_manual_result`, `approve_release`, `request_revision`, `submit_review`, `cancel_project`. Amounts are always computed in the database.
- **Views:** `public_profiles` (directory, no email) and `freelancer_stats` (verified milestones, captured total, pass rate, rating)
- **Storage:** private `resumes` bucket (PDF/Word, 1.5 MB). Users write only to their own folder; signed-in users can read via short-lived signed URLs.

## Project structure

```
src/
  App.tsx              shell, hash router, session + workspace loading
  app-context.ts       shared app state and the act() helper
  ui.tsx               icons, buttons, badges, modal, toast
  lib/
    types.ts           domain types and the Backend interface
    backend.ts         picks Supabase or local mode from .env
    supabaseBackend.ts Supabase implementation (auth, tables, RPCs, storage)
    localBackend.ts    browser-storage implementation with the same rules
    github.ts          GitHub REST checks used at submission time
    plan.ts            milestone plan suggestions
    select.ts          derived data (totals, statuses, progress)
  pages/               one file per screen
supabase/schema.sql    database schema, security and functions
```

## Limitations

- **GitHub checks:** they run in the freelancer's browser, unauthenticated (about 60 GitHub API requests per hour per IP), so the repository must be public. A determined freelancer could forge those results. For production, move `verifyRepository` into a Supabase Edge Function that calls `submit_milestone` with a service key.
- **Payments:** PayPal is simulated; references are generated by the database.
- **Plans:** plan suggestions are keyword-based, not AI-generated.
- **Email and passwords:** there is no email verification or password reset yet; both are planned for later.
