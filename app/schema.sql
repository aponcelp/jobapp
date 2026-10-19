-- Job tracker schema (lives in its own `jobs` schema; never touches public.* Well Run tables)
create schema if not exists jobs;

create table if not exists jobs.allowed_users (email text primary key);

create or replace function jobs.is_owner() returns boolean
language sql stable security definer set search_path = jobs, public as $$
  select coalesce((auth.jwt() ->> 'email') in (select email from jobs.allowed_users), false)
$$;

create table if not exists jobs.roles (
  id bigint generated always as identity primary key,
  rkey text unique not null,               -- lower(company)|lower(role) natural key used by sync
  company text not null, role text not null,
  lane text, priority int, stage text, status text, next_step text, next_step_due date,
  date date, applied_date date, link text, salary_range text, location text, notes text,
  resume_code text, fit_score int, warm_contact text, source text default 'pipeline',
  app_edited_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists jobs.tasks (
  id bigint generated always as identity primary key,
  slug text unique,
  role_id bigint references jobs.roles(id) on delete set null,
  company text, title text not null, type text check (type in ('apply','outreach','follow-up','prep','other')),
  grp text, contact_name text, contact_url text, contact_email text, posting_url text, resume_code text, resume_url text,
  draft text, notes text, due date, done boolean default false, done_at timestamptz, priority int default 3, sort int default 0,
  app_edited_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists jobs.resumes (
  id bigint generated always as identity primary key,
  code text, version text unique not null, lane text, company text, built_for text, drive_url text,
  created date, sent_to text, sent_date text, notes text,
  app_edited_at timestamptz, updated_at timestamptz default now()
);
create table if not exists jobs.contacts (
  id bigint generated always as identity primary key,
  ckey text unique not null,
  name text not null, company text, role text, title text, url text, email text, relation text,
  why text, warm_path text, confidence text, last_touch date, notes text,
  app_edited_at timestamptz, updated_at timestamptz default now()
);
create table if not exists jobs.new_roles (
  id bigint generated always as identity primary key,
  nkey text unique not null,
  company text, role text, link text, salary text, location text, stage_funding text, why_fit text, gap text,
  fit_score int, resume_variant text, posted text, found_at date, source text,
  decision text default 'new' check (decision in ('new','added','skipped')), decided_at timestamptz,
  app_edited_at timestamptz, updated_at timestamptz default now()
);
create table if not exists jobs.activity (
  id bigint generated always as identity primary key,
  at timestamptz default now(), source text, tbl text, row_id bigint, summary text, changes jsonb
);
create table if not exists jobs.sync_meta (
  id int primary key default 1, last_sync_at timestamptz, summary text, check (id = 1)
);
insert into jobs.sync_meta (id) values (1) on conflict do nothing;

-- updated_at + app_edited_at + activity log. Sync sets app.source='sync'; anything else counts as an app edit.
create or replace function jobs.touch() returns trigger language plpgsql security definer set search_path = jobs, public as $$
declare src text := coalesce(nullif(current_setting('app.source', true), ''), 'app');
        diff jsonb := '{}'::jsonb; k text; label text;
begin
  new.updated_at := now();
  if src <> 'sync' then new.app_edited_at := now(); end if;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(to_jsonb(new)) loop
      if k not in ('updated_at','app_edited_at','created_at') and (to_jsonb(new)->k) is distinct from (to_jsonb(old)->k) then
        diff := diff || jsonb_build_object(k, jsonb_build_object('from', to_jsonb(old)->k, 'to', to_jsonb(new)->k));
      end if;
    end loop;
    if diff <> '{}'::jsonb then
      label := coalesce(to_jsonb(new)->>'company','') || ' ' || coalesce(to_jsonb(new)->>'role', to_jsonb(new)->>'title', to_jsonb(new)->>'name', '');
      insert into jobs.activity(source, tbl, row_id, summary, changes)
      values (src, tg_table_name, (to_jsonb(new)->>'id')::bigint, trim(label) || ': ' || (select string_agg(x, ', ') from jsonb_object_keys(diff) x), diff);
    end if;
  elsif tg_op = 'INSERT' and src <> 'sync' then
    insert into jobs.activity(source, tbl, row_id, summary)
    values (src, tg_table_name, (to_jsonb(new)->>'id')::bigint, 'added ' || coalesce(to_jsonb(new)->>'company','') || ' ' || coalesce(to_jsonb(new)->>'role', to_jsonb(new)->>'title', to_jsonb(new)->>'name', ''));
  end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['roles','tasks','resumes','contacts','new_roles'] loop
    execute format('drop trigger if exists trg_touch on jobs.%I', t);
    execute format('create trigger trg_touch before insert or update on jobs.%I for each row execute function jobs.touch()', t);
  end loop;
end $$;

-- Row Level Security: only the allowed signed-in user. anon gets no grants at all.
revoke all on all tables in schema jobs from anon, authenticated;
grant usage on schema jobs to authenticated, anon;
do $$ declare t text; begin
  foreach t in array array['roles','tasks','resumes','contacts','new_roles','activity','sync_meta'] loop
    execute format('alter table jobs.%I enable row level security', t);
    execute format('drop policy if exists owner_all on jobs.%I', t);
    execute format('create policy owner_all on jobs.%I for all to authenticated using (jobs.is_owner()) with check (jobs.is_owner())', t);
    execute format('grant select, insert, update, delete on jobs.%I to authenticated', t);
  end loop;
end $$;
alter table jobs.allowed_users enable row level security;
grant usage, select on all sequences in schema jobs to authenticated;
grant execute on function jobs.is_owner() to authenticated, anon;
alter table jobs.tasks add column if not exists notes text;
alter table jobs.resumes drop constraint if exists resumes_version_key;
alter table jobs.resumes add column if not exists vkey text;
do $$ begin alter table jobs.resumes add constraint resumes_vkey_key unique (vkey); exception when others then null; end $$;
