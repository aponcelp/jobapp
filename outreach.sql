-- Outreach tab (Nov 6 2026). One row per person; events log every feedback / send / revision.
-- Idempotent. Lives in schema `jobs` only.
create table if not exists jobs.outreach (
  id bigint generated always as identity primary key,
  okey text unique not null,                       -- lower(name)|lower(company) natural key used by seed
  name text not null,
  url text,                                        -- LinkedIn / profile URL (only from files or DB, never guessed)
  email text,
  title text,                                      -- their job title
  company text,
  relation text check (relation in ('recruiter','hiring manager','founder','exec','warm intro','peer','investor','other')),
  role_id bigint references jobs.roles(id) on delete set null,
  role_label text,                                 -- role/company this outreach is about
  contact_id bigint references jobs.contacts(id) on delete set null,
  task_id bigint references jobs.tasks(id) on delete set null,
  channel text check (channel in ('linkedin','email','phone','other')),
  connected text default 'unknown' check (connected in ('yes','no','pending','unknown')),
  sent_before text not null default 'unknown' check (sent_before in ('yes','no','unknown')),
  last_sent date,
  last_sent_summary text,                          -- what was sent last, short
  history text,                                    -- short log of known touches (sources named)
  status text not null default 'unknown' check (status in ('unknown','not_contacted','sent','replied','scheduled','closed')),
  next_type text check (next_type in ('connection note','dm','nudge','email','reply','other')),
  next_draft text,
  next_due date,
  meeting_at timestamptz,                          -- a booked call, if any
  followups_sent int not null default 0,           -- nudges sent after the first message (max 2)
  draft_state text not null default 'none' check (draft_state in ('none','ready','needs_draft','needs_revision','revised')),
  draft_version int not null default 1,
  draft_updated_at timestamptz,
  feedback text,                                   -- latest feedback from the app
  feedback_at timestamptz,
  source text,                                     -- where the row was seeded from
  notes text,
  app_edited_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists outreach_due_idx on jobs.outreach (next_due);
create index if not exists outreach_state_idx on jobs.outreach (draft_state);

create table if not exists jobs.outreach_events (
  id bigint generated always as identity primary key,
  outreach_id bigint not null references jobs.outreach(id) on delete cascade,
  at timestamptz default now(),
  kind text not null check (kind in ('feedback','sent','revised','status','note')),
  body text,                                       -- feedback text / what was sent / revision note
  draft_snapshot text,                             -- the draft at that moment
  draft_version int,
  resolved_at timestamptz                          -- feedback: set when a revision answers it
);
create index if not exists outreach_events_oid_idx on jobs.outreach_events (outreach_id, at desc);

drop trigger if exists trg_touch on jobs.outreach;
create trigger trg_touch before insert or update on jobs.outreach for each row execute function jobs.touch();

alter table jobs.outreach enable row level security;
alter table jobs.outreach_events enable row level security;
drop policy if exists owner_all on jobs.outreach;
drop policy if exists owner_all on jobs.outreach_events;
create policy owner_all on jobs.outreach for all to authenticated using (jobs.is_owner()) with check (jobs.is_owner());
create policy owner_all on jobs.outreach_events for all to authenticated using (jobs.is_owner()) with check (jobs.is_owner());
revoke all on jobs.outreach, jobs.outreach_events from anon;
grant select, insert, update, delete on jobs.outreach, jobs.outreach_events to authenticated;
grant usage, select on all sequences in schema jobs to authenticated;

-- Feedback from the app: log it, flag the draft for revision. Runs as the caller (RLS applies).
create or replace function jobs.outreach_submit_feedback(p_id bigint, p_text text)
returns jobs.outreach language plpgsql security invoker set search_path = jobs, public as $$
declare r jobs.outreach;
begin
  if coalesce(trim(p_text), '') = '' then raise exception 'empty feedback'; end if;
  select * into r from jobs.outreach where id = p_id for update;
  if not found then raise exception 'outreach % not found', p_id; end if;
  insert into jobs.outreach_events(outreach_id, kind, body, draft_snapshot, draft_version)
  values (p_id, 'feedback', trim(p_text), r.next_draft, r.draft_version);
  update jobs.outreach set feedback = trim(p_text), feedback_at = now(), draft_state = 'needs_revision'
  where id = p_id returning * into r;
  return r;
end $$;

-- "Mark sent": today (ET) as last sent, status sent, schedule the next nudge +6 days (max two follow-ups).
create or replace function jobs.outreach_mark_sent(p_id bigint)
returns jobs.outreach language plpgsql security invoker set search_path = jobs, public as $$
declare r jobs.outreach; d date := (now() at time zone 'America/New_York')::date; was_nudge boolean; n int;
begin
  select * into r from jobs.outreach where id = p_id for update;
  if not found then raise exception 'outreach % not found', p_id; end if;
  was_nudge := r.next_type = 'nudge';
  n := r.followups_sent + case when was_nudge then 1 else 0 end;
  insert into jobs.outreach_events(outreach_id, kind, body, draft_snapshot, draft_version)
  values (p_id, 'sent', coalesce(r.next_type, 'message') || ' marked sent in the app', r.next_draft, r.draft_version);
  update jobs.outreach set
    sent_before = 'yes', last_sent = d, status = 'sent', followups_sent = n,
    last_sent_summary = coalesce(r.next_type, 'message') || ': ' || left(coalesce(r.next_draft, ''), 160),
    history = concat_ws(E'\n', nullif(r.history, ''), to_char(d, 'Mon DD') || ': ' || coalesce(r.next_type, 'message') || ' sent (marked in app)'),
    next_type = case when n >= 2 then null else 'nudge' end,
    next_due = case when n >= 2 then null else d + 6 end,
    next_draft = null,
    draft_state = case when n >= 2 then 'none' else 'needs_draft' end,
    draft_version = r.draft_version + 1, draft_updated_at = now(),
    feedback = null, feedback_at = null,
    notes = case when n >= 2 then concat_ws(E'\n', nullif(r.notes, ''), 'Two follow-ups sent; no more nudges.') else r.notes end
  where id = p_id returning * into r;
  update jobs.outreach_events set resolved_at = now() where outreach_id = p_id and kind = 'feedback' and resolved_at is null;
  return r;
end $$;

-- Agent side: write a revised (or new nudge) draft and close open feedback. Called by app_sync/revise_outreach.py.
create or replace function jobs.outreach_apply_revision(p_id bigint, p_draft text, p_note text default null)
returns jobs.outreach language plpgsql security invoker set search_path = jobs, public as $$
declare r jobs.outreach;
begin
  update jobs.outreach set next_draft = p_draft, draft_state = 'revised', draft_version = draft_version + 1, draft_updated_at = now()
  where id = p_id returning * into r;
  if not found then raise exception 'outreach % not found', p_id; end if;
  insert into jobs.outreach_events(outreach_id, kind, body, draft_snapshot, draft_version)
  values (p_id, 'revised', coalesce(p_note, 'draft revised'), p_draft, r.draft_version);
  update jobs.outreach_events set resolved_at = now() where outreach_id = p_id and kind = 'feedback' and resolved_at is null;
  return r;
end $$;

revoke all on function jobs.outreach_submit_feedback(bigint, text), jobs.outreach_mark_sent(bigint), jobs.outreach_apply_revision(bigint, text, text) from public, anon;
grant execute on function jobs.outreach_submit_feedback(bigint, text), jobs.outreach_mark_sent(bigint), jobs.outreach_apply_revision(bigint, text, text) to authenticated;
