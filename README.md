# Job Tracker app

A private, single-user job-search tracker. Static HTML/JS (no build step) on top of Supabase.

- `index.html`, `styles.css`, `app.js` — the app (tabs: Today, Progress, Pipeline, To-do, New roles, Résumés, Contacts)
- `config.js` — Supabase URL + **anon** key. Safe to publish: every table in the `jobs` schema has Row Level Security that only lets the owner's signed-in account read or write, and the `anon` role has no table grants.
- `schema.sql` — the `jobs` schema, triggers (updated_at, app_edited_at, activity log) and RLS policies. The owner's email lives only in the database (`jobs.allowed_users`), not in this repo.

No personal data is stored in this repository. All pipeline, contact and draft data lives in Supabase behind sign-in.

Sign-in is an email magic link (public sign-ups are disabled).

## Hosting
- GitHub Pages: the `gh-pages` branch mirrors `app/` (workflow `.github/workflows/pages.yml`).
- Vercel: import the repo with **Root Directory = `app`**, framework "Other", no build command.
