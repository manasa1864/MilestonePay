# MilestonePay

MilestonePay is a web app for paying freelancers for software work one milestone at a time.

A client describes a project and a budget. The plan is split into milestones, each with acceptance criteria that can be checked against a GitHub repository. The client authorizes the whole budget once through PayPal, which holds the money without sending it. The freelancer submits a repository for each milestone, the app checks it, and the client reviews the result. Money is captured and paid out only when the client approves, and the amount is reduced automatically if the work was late.

All payments use the PayPal Sandbox, which is free test money. No real money is ever involved.

## Contents

1. [Quick start](#quick-start)
2. [What the app does](#what-the-app-does)
3. [Environment variables](#environment-variables)
4. [Full setup (Supabase, PayPal, GitHub, AI)](#full-setup)
5. [Reference](#reference)
6. [Project structure](#project-structure)
7. [Limitations](#limitations)

## Quick start

Requirements: Node.js 20 or newer and [pnpm](https://pnpm.io).

```bash
cp .env.example .env
# open .env and enter your values (see "Environment variables" below)
pnpm install
pnpm dev
```

The app opens at http://localhost:8443.

On Windows PowerShell, use `copy .env.example .env` instead of `cp`.

What you get depends on what you put in `.env`:

| `.env` contents | Mode | What works |
| --- | --- | --- |
| Left as the placeholders | Local mode | The whole app, with data stored in your browser and payments simulated. Good for a first look. |
| Supabase URL and anon key filled in | Supabase mode | Real accounts and a shared database. You must also run `supabase/schema.sql` once (see [Full setup](#full-setup)). |
| Supabase values and a PayPal Sandbox Client ID | Supabase mode with PayPal | Real PayPal Sandbox checkout and payouts. This also needs the server-side steps in [Full setup](#full-setup). |

The sidebar shows which mode is active ("Local", "Supabase" or "Supabase + PayPal Sandbox").

## What the app does

### Two kinds of account

| | Client | Freelancer |
| --- | --- | --- |
| Sign-up fields | Name, email, password, **company or organisation (required)**, optional website and what they hire for | Name, email, password, headline, skills, **GitHub username (required)**, **PayPal email for payouts (required)**, optional bio, portfolio website and resume |
| Pages | Overview, Projects, Payments, Find freelancers | Overview, My work, Earnings, My profile |
| Can do | Create, edit (before funding), fund and cancel projects. Approve payments, request revisions, leave reviews. Search freelancer profiles. | Submit milestones, see check results, deadlines and revision requests, receive payouts. |

Sign-up rules:

- The GitHub username is checked against GitHub, so a typo cannot be saved.
- Skills use a search-as-you-type picker with about 600 common skills. A skill not in the list can still be added as typed. A profile can hold up to 50 skills.
- There is no email verification. Anyone can sign up and start working immediately.
- The database enforces the required fields as well as the forms.

### The project flow

1. **Create a project.** The client enters a title, a brief, a budget, the freelancer and a late-delivery penalty (for example 2% per day, capped at 20%).
2. **Get a milestone plan.** A plan is drafted from the title, brief and budget: 2 to 6 milestones, each with a description, a share of the budget, a due date and weighted acceptance criteria. Claude writes it when AI plans are enabled, and a built-in planner is the fallback. The client can edit everything before funding. A chart shows the budget and schedule as the plan is edited.
3. **Fund the project.** The client authorizes the full budget with PayPal. The money is held on their PayPal account and nothing is charged yet. The first milestone opens.
4. **Submit work.** The freelancer pastes a GitHub repository URL for the milestone. The checks run against the latest commit on the default branch:
   - `FILE_EXISTS`: a given file path exists in the repository.
   - `CI_PASSES`: every GitHub check run on the commit succeeded.
   - `PR_MERGED`: at least one pull request is merged into the default branch.
   - `MANUAL_REVIEW`: left for the client to mark Passed or Not passed.
5. **Review.** The client reads the evidence report and marks any manual criteria. Then they either:
   - **Approve**, which captures the release amount from the PayPal authorization and pays it to the freelancer's PayPal email, or
   - **Request a revision**, which sends the freelancer a note. They fix the work and resubmit, and every check runs again.
6. **Finish.** After the last milestone the project completes and PayPal releases anything not captured. Cancelling a funded project voids the remaining authorization.
7. **Review the freelancer.** The client can leave one rating and comment per project once a payment has been captured.

Nothing is ever paid automatically. Every payment starts with the client pressing Approve.

### How the payment amount is calculated

```
base      = milestone amount x (weight of passed criteria / total weight)
days late = submission date - milestone due date      (0 if on time or no due date)
penalty   = min(cap %, days late x % per day)
release   = base x (1 - penalty)
```

Example: a $500 milestone where criteria worth 80% passed, submitted 3 days late at 2% per day with a 20% cap, releases $400 x 94% = $376.00.

Lateness is measured from when the freelancer submits, so a slow client review never penalizes them. The calculation runs in the database (`recompute_verification`) and is shown on the evidence report before the client approves.

### Finding freelancers

Clients use **Find freelancers** to search every freelancer profile.

- Keyword search covers names, headlines, skills, bios and the text inside resumes. Every keyword must match, so `kubernetes terraform` only returns people who have both.
- A skill filter uses the same chip picker as the sign-up form.
- A profile shows skills, bio, GitHub, portfolio, a downloadable resume and reviews. It never shows earnings, payments or PayPal emails.

Resumes become searchable when the freelancer picks the file. The browser reads the text immediately:

| File | Method |
| --- | --- |
| PDF with selectable text | Read directly with pdf.js |
| Scanned or image-only PDF | Pages are rendered and read with OCR (Tesseract.js, first 4 pages) |
| Word `.docx` | Read with mammoth |
| Old Word `.doc` | Cannot be read in the browser. The upload works but is not searchable. |

The text (up to 20,000 characters) is stored in `profiles.resume_text` and only appears elsewhere as a short snippet in search results. The OCR language data downloads from a CDN the first time it is used.

### Charts

- **Plan at a glance** (creating or editing a project): budget per milestone, plus a schedule bar from start to due date.
- **Milestones at a glance** (project page): each milestone's budget split into captured and not captured, plus its schedule with a line for today.
- **Captured by project** (Payments): how much of each project's budget has been paid out.

Charts use one colour in two shades checked for contrast in light and dark mode. Status is written as text, values show on hover and keyboard focus, and each chart has a **View as table** option.

## Environment variables

All variables in `.env` are bundled into the website and are public. Never put a secret in this file.

| Variable | Where to find it | Required |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Supabase project: Project Settings, API, Project URL | For Supabase mode |
| `VITE_SUPABASE_ANON_KEY` | Same page: anon or publishable key. Never the service-role or secret key. | For Supabase mode |
| `VITE_PAYPAL_CLIENT_ID` | developer.paypal.com: Apps & Credentials, Sandbox, your app, Client ID | For PayPal checkout |

Restart `pnpm dev` after changing `.env`.

Server-side secrets (PayPal Secret, GitHub token, Anthropic API key) are stored in Supabase and never in `.env`:

| Secret | Used by | Purpose |
| --- | --- | --- |
| `PAYPAL_CLIENT_ID` | `paypal` function | Same Client ID as above |
| `PAYPAL_SECRET` | `paypal` function | PayPal Sandbox Secret |
| `GITHUB_TOKEN` | `github-verify` function | One GitHub token for server-side checks (optional) |
| `ANTHROPIC_API_KEY` | `plan-milestones` function | Claude milestone plans (optional) |
| `PLAN_MODEL`, `PLAN_EFFORT` | `plan-milestones` function | Optional model and effort overrides |

## Full setup

Local mode needs none of this. Follow these steps to get real accounts, PayPal Sandbox payments, server-side GitHub checks and Claude plans.

### 1. Supabase

1. Create a Supabase project.
2. Open **SQL Editor** and run [supabase/schema.sql](supabase/schema.sql). It is safe to run again after updates.
3. Put the project URL and anon key in `.env`.
4. Turn off **Confirm email** under Authentication, Sign In / Providers, Email, so people can sign up and be logged straight in.
5. Restart `pnpm dev`. The sidebar should say Supabase.

To clear all test accounts and start over, run [supabase/reset-test-data.sql](supabase/reset-test-data.sql) in the SQL editor.

### 2. PayPal Sandbox

Create these at developer.paypal.com, under Testing Tools, Sandbox Accounts. Use the same country for all of them (United States works well).

| Account | Role in MilestonePay |
| --- | --- |
| **Business** | The merchant your REST app belongs to. It receives captures and sends payouts. Never log into checkout with it. |
| **Personal (client)** | Log into the PayPal checkout window with this account when funding a project. |
| **Personal (freelancer)** | Put its email in the freelancer's "PayPal email for payouts". |

Then:

1. Under Apps & Credentials (Sandbox), create a REST app tied to the Business account. Copy its Client ID and Secret.
2. Put the Client ID in `.env` as `VITE_PAYPAL_CLIENT_ID`.
3. Install the Supabase CLI (it cannot be installed with `npm i -g`). On Windows with [Scoop](https://scoop.sh):

   ```powershell
   scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
   scoop install supabase
   ```

4. Log in, link the project and deploy. The project ref is the part of your Supabase URL before `.supabase.co`.

   ```powershell
   supabase login
   supabase link --project-ref your-project-ref
   supabase secrets set PAYPAL_CLIENT_ID=your-client-id PAYPAL_SECRET=your-secret
   supabase functions deploy paypal
   ```

5. Switch PayPal on in the SQL editor:

   ```sql
   update public.app_settings set paypal_enabled = true;
   ```

6. Restart `pnpm dev`. The funding page now shows PayPal buttons.

If PayPal's popup says "You are logging into the account of the seller", you used the Business account. Log out of the popup and sign in with the client Personal account.

### 3. GitHub checks (optional)

Without this step, checks run in the freelancer's browser against the public GitHub API with no token. That allows about 60 requests an hour per IP address, works for public repositories only, and a determined freelancer could fake the results.

To run the checks on the server with one token (5,000 requests an hour, results cannot be faked):

1. On GitHub, go to Settings, Developer settings, Fine-grained tokens, and create a token. "Public repositories (read-only)" is enough for public repos.
2. Deploy:

   ```bash
   supabase secrets set GITHUB_TOKEN=your-token
   supabase functions deploy github-verify
   ```

3. In the SQL editor: `update public.app_settings set server_github_checks = true;`

One token can read any public repository, so testing with other people's repositories needs no extra accounts. For a private repository, the owner adds your GitHub account as a collaborator. Using several accounts' tokens to raise the limit is against GitHub's terms.

### 4. AI milestone plans (optional)

1. Create an API key at console.anthropic.com and add credits under Billing.
2. Deploy:

   ```bash
   supabase secrets set ANTHROPIC_API_KEY=your-key
   supabase functions deploy plan-milestones
   ```

3. In the SQL editor: `update public.app_settings set ai_plans_enabled = true;`

Without this, or if the API cannot be reached, the built-in planner is used. It recognises the project type (online shop, mobile app, API, AI/ML, dashboard, automation, game and others), sizes the plan to the budget and sets due dates.

| Setting | Default | Notes |
| --- | --- | --- |
| Model | `claude-opus-5-5` | Change with the secret `PLAN_MODEL`, for example `claude-sonnet-5-5` or `claude-haiku-5-5` (cheaper). |
| Effort | `medium` | Secret `PLAN_EFFORT`: `low` is faster, `high` thinks longer. |
| Daily limit | 20 plans per client per 24 hours | Failed attempts do not count. Set in `supabase/functions/_shared/plan.ts`. |
| Cost | About $0.05 to $0.10 per plan on Opus 5.5 | Less on Sonnet or Haiku. |

How it works: the `plan-milestones` Edge Function makes one request through the Anthropic SDK using structured outputs (a JSON schema, so the reply is always valid JSON) and server-side fallbacks (the API retries on a fallback model if Claude declines). The project brief is treated as data, not instructions. The reply is then cleaned in code: percentages and criteria weights are made to total exactly 100, file paths must be safe relative paths, and every due date stays within 28 days.

## Reference

### PayPal money flow

All calls are made by the `paypal` Edge Function, never from the browser.

| Step | PayPal API | Notes |
| --- | --- | --- |
| Fund | `POST /v2/checkout/orders` (intent `AUTHORIZE`), then `.../authorize` | The full budget is held. The database checks that the amount matches the project budget. |
| Approve a milestone | `POST /v2/payments/authorizations/{id}/capture` | Captures the release amount after any late penalty. The last milestone uses `final_capture`. A `PayPal-Request-Id` header makes retries safe, so there are no double charges. |
| Pay the freelancer | `POST /v1/payments/payouts` | Sends the captured amount to the freelancer's PayPal email. If it fails, the payout can be retried from the project page. |
| Cancel | `POST /v2/payments/authorizations/{id}/void` | Releases everything not yet captured. |

PayPal authorizations last 29 days, so due dates are limited to 28 days from creation.

### GitHub API calls

| Request | Used for |
| --- | --- |
| `GET /repos/{owner}/{repo}` | The repository exists; find the default branch |
| `GET /repos/{owner}/{repo}/commits/{branch}` | The latest commit that every check runs against |
| `GET .../commits/{sha}/check-runs`, then `.../status` | `CI_PASSES` |
| `GET .../contents/{path}?ref={sha}` | `FILE_EXISTS` |
| `GET .../pulls?state=closed&base={branch}` | `PR_MERGED` |

### Database

Defined in [supabase/schema.sql](supabase/schema.sql):

- **Tables:** `app_settings`, `profiles`, `projects`, `milestones`, `criteria`, `submissions`, `verifications`, `verification_results`, `revisions`, `payments`, `reviews`, `activity`, `plan_requests`.
- **Row Level Security** on every table. Users see only their own projects and can edit only their own profile.
- **User functions** (`create_project`, `update_draft_project`, `authorize_project`, `submit_milestone`, `set_manual_result`, `approve_release`, `request_revision`, `submit_review`, `cancel_project`, `project_contacts`, `search_freelancers`). Every state change goes through these. The ones that move money refuse to run once PayPal is switched on, so the browser cannot bypass the server.
- **Service functions** (`svc_*`), callable only with the service-role key from the Edge Functions. They record PayPal, GitHub and AI results after the server has verified them.
- **Views:** `public_profiles` (the freelancer directory, with no email) and `freelancer_stats`.
- **Storage:** a private `resumes` bucket for PDF and Word files up to 1.5 MB.
- **Settings switches** in `app_settings`: `paypal_enabled`, `server_github_checks`, `ai_plans_enabled`.

## Project structure

```
src/
  App.tsx                  shell, hash router, session, workspace and settings loading
  lib/
    types.ts               domain types and the Backend interface
    backend.ts             picks Supabase or local mode from .env
    supabaseBackend.ts     Supabase implementation (auth, RPCs, storage, Edge Functions)
    localBackend.ts        browser-storage implementation with the same rules
    plan.ts                built-in milestone planner
    skills.ts              skill catalog and typeahead ranking
    resumeText.ts          reads resume text in the browser (pdf.js, OCR, mammoth)
    githubUser.ts          checks that a GitHub username exists
    paypalSdk.ts           loads the PayPal checkout buttons
  charts/                  MilestoneChart (budget and schedule per milestone)
  pages/                   one file per screen
supabase/
  schema.sql               database schema, security and functions
  reset-test-data.sql      deletes all test accounts
  functions/
    paypal/                orders, authorization, capture, payout, void
    github-verify/         server-side GitHub checks
    plan-milestones/       Claude milestone plans
    _shared/               PayPal client, GitHub checks, plan logic, shared by the functions
```

## Limitations

- No email verification or password reset.
- PayPal authorizations expire after 29 days, so projects longer than that would need re-authorization or one order per milestone.
- The automatic checks look at whether files, CI runs and merged pull requests exist. They cannot judge the content of a file, so content-level criteria use the client-review option.
- Switching from Sandbox to live PayPal needs live credentials and the secret `PAYPAL_API_BASE=https://api-m.paypal.com`. Do not set this for testing.
