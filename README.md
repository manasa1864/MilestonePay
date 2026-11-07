# MilestonePay

Milestone-based payments for software projects. Clients define milestones, authorize funds once, and release payment only after GitHub-backed verification passes. Freelancers submit work against clear acceptance criteria and get paid for what verifies.

> Demonstration environment. Payments are simulated with PayPal Sandbox; no real funds move.

## Features

- **Two account types**, each with its own workspace:
  - **Client**: create projects, review AI-generated milestone plans, authorize funding, approve or request revisions on verified work, browse freelancers.
  - **Freelancer**: see assigned work, submit GitHub repositories, respond to verification feedback, track earnings, and manage a public profile with an optional portfolio website and resume.
- Evidence reports with weighted acceptance criteria
- Light, dark and system themes; responsive layout

## Tech stack

React 19, Vite, TypeScript, Tailwind CSS v4. Formatting with oxfmt.

## Getting started

```bash
npm install
cp .env.example .env   # then fill in your Supabase values
npm run dev
```

Other scripts: `npm run build`, `npm run preview`, `npm run format`.

## Environment variables

| Variable | Description |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon (public) key |

`.env` is git-ignored; `.env.example` is the tracked template.

## Project structure

```
src/
  App.tsx      # app shell, auth, role-based pages
  index.css    # global styles and Tailwind import
  main.tsx     # entrypoint
```

## Current limitations

- Accounts, profiles and resumes are stored in the browser (local storage) only. Supabase is configured via `.env` but not wired in yet.
- Projects, payments and verification results are sample data.
