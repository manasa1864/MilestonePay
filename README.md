# MilestonePay

Milestone-based payments for software projects. Clients define milestones, authorize the budget once with PayPal, and release payment only after GitHub-backed verification passes. Freelancers submit work against clear acceptance criteria and get paid for what verifies, minus a late penalty if they miss the deadline.

> Uses the **PayPal Sandbox**: test money only. Without PayPal configured, payments are simulated.

## How it works

1. **Client** creates a project with a brief, budget, freelancer and **late-delivery penalty** (for example 2% per day late, capped at 20%).
2. MilestonePay suggests a 2–5 milestone plan. The client edits milestones, percentages, **due dates** and weighted acceptance criteria. Drafts stay editable until funded.
3. **Client** authorizes the full budget with PayPal. The money is held on their PayPal account, not charged. Milestone 01 opens.
4. **Freelancer** submits a GitHub repository. Checks run against the latest commit on the default branch:
   - `CI_PASSES`: all GitHub check runs (or the combined status) succeed
   - `FILE_EXISTS`: a configured file path exists
   - `PR_MERGED`: at least one PR is merged into the default branch
   - `MANUAL_REVIEW`: left for the client to judge
5. **Client** reviews the evidence report, marks client-review criteria, then either:
   - **approves**, which captures the release amount from the PayPal authorization and pays it out to the freelancer's PayPal; or
   - **requests a revision**; the freelancer resubmits and every check reruns.
6. After the final milestone the project completes and PayPal releases whatever wasn't captured. Cancelling a funded project voids the authorization.
7. Clients can leave one review per project once a payment has been captured.

### Release amount

```
base      = milestone amount × (weight of passed criteria ÷ total weight)
days late = submission date − milestone due date   (0 if on time or no due date)
penalty   = min(cap %, days late × % per day)
release   = base × (1 − penalty)
```

Example: a $500 milestone with 80% of criteria passed, submitted 3 days late at 2%/day (cap 20%), releases $400 × 94% = **$376.00**. Lateness is based on when the freelancer **submits**, so a slow client review never penalizes them. The calculation runs in the database (`recompute_verification`) and is shown on the evidence report.

## Account types

| | Client | Freelancer |
| --- | --- | --- |
| Navigation | Overview, Projects, Payments, Find freelancers | Overview, My work, Earnings, My profile |
| Profile | Company, website, what they hire for | Headline, **skills (pick from a searchable list)**, GitHub, bio, portfolio website, resume, **PayPal email for payouts** (all but the headline and skills are optional) |
| Can | Create, edit (before funding), fund and cancel projects; approve releases; request revisions; review freelancers | Submit milestones; see evidence, deadlines and revision requests; get paid out |

## Finding freelancers (client search)

Every freelancer who signs up shows up under **Find freelancers**. Clients can:

- **Search by keyword.** It looks through names, headlines, skills, bios and the **text inside resumes**. Every keyword must match, so `kubernetes terraform` only returns people who have both.
- **Filter by skill** using the same chip picker freelancers use (it only suggests skills that exist on profiles).
- **Open a profile** to see skills, bio, GitHub, portfolio, a downloadable resume and reviews. Profiles never show earnings, payments or PayPal emails.

**How resumes become searchable.** When a freelancer picks a resume, the browser reads its text on the spot (`src/lib/resumeText.ts`):

| File | Method |
| --- | --- |
| PDF with selectable text | read directly with pdf.js |
| Scanned / image-only PDF | each page is rendered and read with **OCR** (Tesseract.js, first 4 pages) |
| Word `.docx` | read with mammoth |
| Old Word `.doc` | can't be read in the browser; the upload works but isn't searchable |

The text (up to 20,000 characters) is stored in `profiles.resume_text`. It never leaves the database except as a short snippet in search results. The OCR language data downloads from a CDN the first time it's used. Resumes uploaded before this feature can be indexed from **Edit profile → Make it searchable**.

## Getting started

```bash
pnpm install        # or npm install
pnpm dev            # http://localhost:8443
```

Without Supabase settings the app runs in **local mode**: everything works, but data stays in this browser and payments are simulated. The sidebar shows which mode is active.

## 1. Connect Supabase

1. Create a Supabase project.
2. In **SQL Editor**, run [`supabase/schema.sql`](supabase/schema.sql). It is safe to run more than once.
3. In `.env` (copy `.env.example`), set the values from **Project Settings → API**:

   | Variable | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | Project URL |
   | `VITE_SUPABASE_ANON_KEY` | anon / publishable key (never the secret / service-role key) |

4. Turn off **Confirm email** (Authentication → Sign In / Providers → Email). Anyone can then sign up and is logged straight in.
5. Restart `pnpm dev`. The sidebar shows **Supabase**.

## 2. PayPal Sandbox

### What you need from developer.paypal.com

| Item | Where | Goes into |
| --- | --- | --- |
| **Client ID** | Apps & Credentials → Sandbox → your REST app | `.env` → `VITE_PAYPAL_CLIENT_ID` (public) **and** Supabase secret `PAYPAL_CLIENT_ID` |
| **Secret** | Same app | Supabase secret `PAYPAL_SECRET` only. Never put it in `.env`. |
| **Sandbox Business account** | Testing Tools → Sandbox Accounts (created automatically) | Receives captures and sends payouts. It's the account your REST app belongs to. |
| **Sandbox Personal account(s)** | Same page (one is created automatically; add more if you like) | The **client** logs into PayPal checkout with one. The **freelancer** puts one's email in their profile to receive payouts. |

Payouts must be enabled on the sandbox business account. They usually are by default. If payouts fail with a permissions error, enable **Payouts** for the app under Apps & Credentials.

### Deploy the Edge Function

These are terminal commands, run one at a time from the project folder.

**1. Install the Supabase CLI once.** It can't be installed with `npm i -g`. On Windows with [Scoop](https://scoop.sh):

```powershell
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
```

(Or skip installing and put `npx supabase` wherever these steps say `supabase`.)

**2. Log in and connect this folder to your project.** Your project ref is the part of your Supabase URL before `.supabase.co`:

```powershell
supabase login
supabase link --project-ref your-project-ref
```

**3. Store the PayPal keys on Supabase.** Replace the placeholders with your sandbox Client ID and Secret, without the angle brackets:

```powershell
supabase secrets set PAYPAL_CLIENT_ID=your-client-id PAYPAL_SECRET=your-secret
```

**4. Upload the function:**

```powershell
supabase functions deploy paypal
```

Then switch it on in the SQL editor:

```sql
update public.app_settings set paypal_enabled = true;
```

Set `VITE_PAYPAL_CLIENT_ID` in `.env` and restart `pnpm dev`. The funding page now shows PayPal buttons.

### Money flow

| Step | PayPal API (server only) | Notes |
| --- | --- | --- |
| Fund | `POST /v2/checkout/orders` (intent `AUTHORIZE`), then `POST /v2/checkout/orders/{id}/authorize` | Full budget is held on the client's account. The database checks the amount matches the budget. |
| Approve milestone | `POST /v2/payments/authorizations/{id}/capture` | Captures the release amount (after late penalty). `final_capture` is set on the last milestone so PayPal releases the rest. A `PayPal-Request-Id` makes retries safe: no double charges. |
| Pay freelancer | `POST /v1/payments/payouts` | Sends the captured amount to the freelancer's PayPal email. If they haven't added one, the payout waits and can be sent later from the project page. |
| Cancel | `POST /v2/payments/authorizations/{id}/void` | Releases everything not yet captured. |

**Authorizations last 29 days.** PayPal won't let you capture after that, so keep sandbox test projects' due dates within 29 days. The app warns when they aren't.

## 3. GitHub checks

Without setup, checks run in the freelancer's browser against the public [GitHub REST API](https://docs.github.com/en/rest) with no token. That's about 60 requests an hour per IP, public repositories only, and a determined freelancer could fake the results.

To run them on the server with **one** GitHub token (5,000 requests/hour, results can't be faked):

1. GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate. For public repos, "Public repositories (read-only)" is enough.
2. Deploy:

   ```bash
   supabase secrets set GITHUB_TOKEN=<token>
   supabase functions deploy github-verify
   ```

3. In the SQL editor: `update public.app_settings set server_github_checks = true;`

**Testing with friends' repositories:** you don't need their accounts or tokens. Your one token can read any **public** repository. For a **private** repository, the owner adds your GitHub account as a collaborator. Using several accounts' tokens to raise the rate limit is against GitHub's terms, so the app uses a single token.

| Request | Used for |
| --- | --- |
| `GET /repos/{owner}/{repo}` | Repository exists; default branch |
| `GET /repos/{owner}/{repo}/commits/{branch}` | Latest commit SHA that every check runs against |
| `GET .../commits/{sha}/check-runs`, then `.../status` | `CI_PASSES` |
| `GET .../contents/{path}?ref={sha}` | `FILE_EXISTS` |
| `GET .../pulls?state=closed&base={branch}` | `PR_MERGED` |

## Secrets: where each value goes

| Value | `.env` (public, bundled into the site) | Supabase secrets (server only) |
| --- | --- | --- |
| Supabase URL, anon/publishable key | ✅ | automatic |
| Supabase service-role / secret key | ❌ never | automatic (`SUPABASE_SERVICE_ROLE_KEY`) |
| PayPal Client ID | ✅ `VITE_PAYPAL_CLIENT_ID` | ✅ `PAYPAL_CLIENT_ID` |
| PayPal Secret | ❌ never | ✅ `PAYPAL_SECRET` |
| GitHub token | ❌ never | ✅ `GITHUB_TOKEN` |

## What the SQL sets up

- **Tables:** `app_settings`, `profiles`, `projects`, `milestones`, `criteria`, `submissions`, `verifications`, `verification_results`, `revisions`, `payments`, `reviews`, `activity`
- **`search_freelancers()`:** the keyword and skill search used by clients; returns ids, a ranking and a snippet from the resume.
- **Row Level Security** on every table. Users only see projects they're on, and can edit only their own profile's editable columns.
- **User RPCs:** `create_project`, `update_draft_project`, `authorize_project`*, `submit_milestone`*, `set_manual_result`, `approve_release`*, `request_revision`, `submit_review`, `cancel_project`*, `project_contacts`. The starred ones refuse to run once PayPal or server checks are switched on, so the browser can't bypass them.
- **Service RPCs (`svc_*`):** callable only with the service-role key, i.e. from the Edge Functions. They record PayPal and GitHub results after the server has verified them.
- **Views:** `public_profiles` (directory, no email) and `freelancer_stats`.
- **Storage:** private `resumes` bucket (PDF/Word, 1.5 MB).

## Project structure

```
src/
  App.tsx                  shell, hash router, session, workspace + settings loading
  lib/
    types.ts               domain types and the Backend interface
    backend.ts             picks Supabase or local mode from .env
    supabaseBackend.ts     Supabase implementation (auth, RPCs, storage, Edge Functions)
    localBackend.ts        browser-storage implementation with the same rules
    paypalSdk.ts           loads the PayPal checkout buttons
    github.ts              re-exports the shared GitHub checks
    skills.ts              skill catalog and typeahead ranking
    resumeText.ts          reads resume text in the browser (pdf.js, OCR, mammoth)
  pages/                   one file per screen
supabase/
  schema.sql               database schema, security and functions
  functions/
    paypal/                Edge Function: orders, authorization, capture, payout, void
    github-verify/         Edge Function: server-side GitHub checks
    _shared/               PayPal client, GitHub checks, action logic (shared with the browser where possible)
```

## Limitations and next steps

- **Email:** no email verification or password reset yet.
- **Long projects:** PayPal authorizations expire after 29 days. Longer projects would need re-authorization or one order per milestone.
- **Plans:** suggestions are keyword-based, not AI-generated.
- **Live PayPal:** switching from sandbox to live needs live credentials and `PAYPAL_API_BASE=https://api-m.paypal.com` as a secret.
