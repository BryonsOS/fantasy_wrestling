-- Fantasy Wrestling League schema (applied to Supabase project cnchsowyukaioujfrups
-- as migrations "fantasy_wrestling_schema" and "lock_down_function_grants").
-- Kept in the repo for reference / disaster recovery.

-- ============ TABLES ============

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.league_settings (
  id boolean primary key default true check (id),
  league_name text not null default 'Fantasy Wrestling League',
  invite_code text not null,
  admin_email text not null
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  promotion text,
  event_date date,
  status text not null default 'draft' check (status in ('draft','open','locked','final')),
  created_at timestamptz not null default now()
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  kind text not null default 'match' check (kind in ('match','prop')),
  title text not null,
  detail text,
  points int not null default 1 check (points >= 1),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  label text not null,
  sort_order int not null default 0,
  unique (id, question_id)
);

alter table public.questions
  add column correct_option_id uuid references public.options(id) on delete set null;

create table public.picks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  option_id uuid not null,
  updated_at timestamptz not null default now(),
  unique (user_id, question_id),
  -- option must belong to the question being answered
  foreign key (option_id, question_id) references public.options(id, question_id) on delete cascade
);

create index picks_question_idx on public.picks (question_id);
create index questions_event_idx on public.questions (event_id);
create index options_question_idx on public.options (question_id);

-- ============ SEED ============

insert into public.league_settings (league_name, invite_code, admin_email)
values ('Fantasy Wrestling League', 'KAYFABE2026', 'rompabryon@gmail.com');

-- ============ HELPERS ============

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_member()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid())
$$;

-- Signup validation: anyone can check an invite code (needed pre-auth on the signup form)
create or replace function public.validate_invite(code text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.league_settings
    where upper(trim(invite_code)) = upper(trim(code))
  )
$$;

grant execute on function public.validate_invite(text) to anon, authenticated;

-- ============ SIGNUP TRIGGER ============

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  s record;
  dn text;
begin
  select * into s from public.league_settings limit 1;
  dn := coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(new.email, '@', 1));

  if lower(new.email) = lower(s.admin_email) then
    insert into public.profiles (id, display_name, is_admin) values (new.id, dn, true);
  else
    if upper(trim(coalesce(new.raw_user_meta_data->>'invite_code', ''))) <> upper(trim(s.invite_code)) then
      raise exception 'Invalid invite code';
    end if;
    insert into public.profiles (id, display_name, is_admin) values (new.id, dn, false);
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ RLS ============

alter table public.profiles enable row level security;
alter table public.league_settings enable row level security;
alter table public.events enable row level security;
alter table public.questions enable row level security;
alter table public.options enable row level security;
alter table public.picks enable row level security;

-- profiles: members can see everyone (for leaderboards); users may update only their display name
create policy "members read profiles" on public.profiles
  for select to authenticated using (public.is_member());
create policy "update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

-- league settings: admin only (signup trigger + validate_invite run as definer)
create policy "admin reads settings" on public.league_settings
  for select to authenticated using (public.is_admin());
create policy "admin updates settings" on public.league_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- events: members see non-draft; admin sees & manages all
create policy "members read events" on public.events
  for select to authenticated using (public.is_member() and (status <> 'draft' or public.is_admin()));
create policy "admin writes events" on public.events
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- questions/options: visible when their event is visible; admin manages
create policy "members read questions" on public.questions
  for select to authenticated using (
    public.is_member() and exists (
      select 1 from public.events e
      where e.id = event_id and (e.status <> 'draft' or public.is_admin())
    )
  );
create policy "admin writes questions" on public.questions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "members read options" on public.options
  for select to authenticated using (
    public.is_member() and exists (
      select 1 from public.questions q
      join public.events e on e.id = q.event_id
      where q.id = question_id and (e.status <> 'draft' or public.is_admin())
    )
  );
create policy "admin writes options" on public.options
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- picks:
--   read own picks any time; everyone's picks once the event is locked/final; admin any time
create policy "read picks" on public.picks
  for select to authenticated using (
    user_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.questions q
      join public.events e on e.id = q.event_id
      where q.id = question_id and e.status in ('locked','final')
    )
  );

--   make/change picks only on your own row and only while the event is open
create policy "insert own picks while open" on public.picks
  for insert to authenticated with check (
    user_id = auth.uid() and exists (
      select 1 from public.questions q
      join public.events e on e.id = q.event_id
      where q.id = question_id and e.status = 'open'
    )
  );
create policy "update own picks while open" on public.picks
  for update to authenticated using (
    user_id = auth.uid() and exists (
      select 1 from public.questions q
      join public.events e on e.id = q.event_id
      where q.id = question_id and e.status = 'open'
    )
  ) with check (
    user_id = auth.uid() and exists (
      select 1 from public.questions q
      join public.events e on e.id = q.event_id
      where q.id = question_id and e.status = 'open'
    )
  );
create policy "delete own picks while open" on public.picks
  for delete to authenticated using (
    user_id = auth.uid() and exists (
      select 1 from public.questions q
      join public.events e on e.id = q.event_id
      where q.id = question_id and e.status = 'open'
    )
  );

-- ============ FUNCTION GRANT LOCKDOWN ============

-- Trigger function: never callable through the API
revoke execute on function public.handle_new_user() from anon, authenticated, public;

-- Helper functions: needed by RLS for signed-in users, but not for anon
revoke execute on function public.is_admin() from anon, public;
revoke execute on function public.is_member() from anon, public;

-- validate_invite stays callable by anon intentionally (pre-signup check),
-- but not by the general public role
revoke execute on function public.validate_invite(text) from public;
