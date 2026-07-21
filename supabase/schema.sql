-- ============================================================
--  MORIYA NAILS – Supabase schema
--  Run this in: Supabase → SQL Editor → New query → paste → Run
-- ============================================================

-- ---------- Helper: is the current user an admin? ----------
create or replace function public.is_admin()
returns boolean
language sql stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') in (
    'eliran.viente@gmail.com',
    'moriya681@gmail.com'
  );
$$;

-- ============================================================
--  1) PROFILES – one row per logged-in user (for autofill)
-- ============================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  phone       text,
  created_at  timestamptz default now(),
  -- Last successful login, synced from auth.users.last_sign_in_at (see trigger below).
  last_login  timestamptz,
  -- The client's most relevant appointment: their upcoming one, or — if none —
  -- the last one that actually happened. Cancelled/no-show are ignored.
  -- Maintained automatically by a trigger on `appointments` (see below).
  last_appointment timestamptz
);
-- Add the columns on databases created before they existed.
alter table public.profiles add column if not exists last_login       timestamptz;
alter table public.profiles add column if not exists last_appointment timestamptz;

-- Auto-create a profile row whenever a new user signs up with Google
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name',
             new.raw_user_meta_data ->> 'name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep profiles.last_login in sync with Supabase's own auth.users.last_sign_in_at,
-- which the platform updates automatically on every successful login. This is the
-- authoritative source, so no client-side code is needed and existing users are
-- populated immediately by the backfill below.
create or replace function public.sync_last_login()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update public.profiles
  set last_login = new.last_sign_in_at
  where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_login on auth.users;
create trigger on_auth_user_login
  after update of last_sign_in_at on auth.users
  for each row
  when (new.last_sign_in_at is distinct from old.last_sign_in_at)
  execute function public.sync_last_login();

-- Backfill last_login for users who already signed in before this trigger existed.
update public.profiles p
set last_login = u.last_sign_in_at
from auth.users u
where u.id = p.id;

-- ============================================================
--  2) AVAILABILITY – working windows & breaks (admin-managed)
--     Fridays are work days by default (09:00–17:00) with no row needed.
--     kind='open'   e.g. date=2026-06-26, 09:00–17:00 → sliced into 90-min slots
--     kind='block'  e.g. date=2026-06-26, 12:00–13:00 → a break inside the day
--     kind='closed' e.g. date=2026-06-26                → turns off a default day
-- ============================================================
create table if not exists public.availability (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  start_time  time not null,
  end_time    time not null,
  -- 'open'   = a working window, sliced into bookable slots for clients
  -- 'block'  = a break inside the day (not bookable)
  -- 'closed' = marks a whole day off (used to disable a default Friday)
  kind        text not null default 'open',
  created_at  timestamptz default now()
);
-- Add the column on databases created before 'kind' existed.
alter table public.availability add column if not exists kind text not null default 'open';
create index if not exists idx_availability_date on public.availability(date);

-- ============================================================
--  3) APPOINTMENTS
-- ============================================================
create table if not exists public.appointments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) on delete set null,
  client_name     text not null,
  client_phone    text not null,
  date            date not null,
  start_time      time not null,
  duration_min    int  not null,
  services        jsonb default '[]'::jsonb,
  total_price     numeric default 0,
  status          text not null default 'booked',  -- booked | cancelled | done | no_show
  google_event_id text,
  notes           text,
  created_at      timestamptz default now()
);
create index if not exists idx_appointments_date on public.appointments(date);
create index if not exists idx_appointments_user on public.appointments(user_id);

-- ============================================================
--  LAST APPOINTMENT – keep profiles.last_appointment in sync
--  Definition: the latest appointment (date + time) among a user's
--  'booked' (upcoming) or 'done' (already happened) appointments.
--  Cancelled and no-show appointments are excluded. Times are read as
--  Israel local wall-time and stored as a proper timestamptz.
-- ============================================================
create or replace function public.refresh_last_appointment(p_user uuid)
returns void
language sql security definer set search_path = public
as $$
  update public.profiles p
  set last_appointment = (
    select max((a.date + a.start_time) at time zone 'Asia/Jerusalem')
    from public.appointments a
    where a.user_id = p_user
      and a.status in ('booked', 'done')
  )
  where p.id = p_user;
$$;

-- Recompute for the affected user(s) on any insert/update/delete.
create or replace function public.appointments_touch_last()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (tg_op = 'DELETE') then
    perform public.refresh_last_appointment(old.user_id);
    return old;
  end if;
  perform public.refresh_last_appointment(new.user_id);
  -- If the appointment was reassigned to another user, refresh the old one too.
  if (tg_op = 'UPDATE' and old.user_id is distinct from new.user_id) then
    perform public.refresh_last_appointment(old.user_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_appointments_last on public.appointments;
create trigger trg_appointments_last
  after insert or update or delete on public.appointments
  for each row execute function public.appointments_touch_last();

-- One-time backfill for appointments that already exist.
update public.profiles p
set last_appointment = sub.last_appt
from (
  select user_id,
         max((date + start_time) at time zone 'Asia/Jerusalem') as last_appt
  from public.appointments
  where status in ('booked', 'done') and user_id is not null
  group by user_id
) sub
where p.id = sub.user_id;

-- ============================================================
--  ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles     enable row level security;
alter table public.availability enable row level security;
alter table public.appointments enable row level security;

-- ----- PROFILES -----
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (id = auth.uid());

-- ----- AVAILABILITY (everyone reads open hours; only admin writes) -----
drop policy if exists "availability_read" on public.availability;
create policy "availability_read" on public.availability
  for select using (true);

drop policy if exists "availability_admin_write" on public.availability;
create policy "availability_admin_write" on public.availability
  for all using (public.is_admin()) with check (public.is_admin());

-- ----- APPOINTMENTS -----
drop policy if exists "appointments_select" on public.appointments;
create policy "appointments_select" on public.appointments
  for select using (user_id = auth.uid() or public.is_admin());

-- logged-in users can create their own appointment
drop policy if exists "appointments_insert_own" on public.appointments;
create policy "appointments_insert_own" on public.appointments
  for insert with check (user_id = auth.uid());

-- a user can update (e.g. cancel) their own; admin can update anything
drop policy if exists "appointments_update" on public.appointments;
create policy "appointments_update" on public.appointments
  for update using (user_id = auth.uid() or public.is_admin());

-- only admin can delete
drop policy if exists "appointments_admin_delete" on public.appointments;
create policy "appointments_admin_delete" on public.appointments
  for delete using (public.is_admin());

-- ============================================================
--  CLIENTS REPORT – one readable row per client
--  View it any time:  select * from public.clients_report;
--  security_invoker keeps the underlying RLS in force, so only an
--  admin sees every client (a client querying it sees only themselves).
-- ============================================================
create or replace view public.clients_report
with (security_invoker = true) as
select
  p.full_name                                              as "שם",
  p.phone                                                  as "טלפון",
  p.email                                                  as "אימייל",
  -- Times are truncated to whole seconds (no sub-second digits) for readability.
  date_trunc('second', p.created_at)                       as "נרשם/ה",
  date_trunc('second', p.last_login)                       as "התחברות אחרונה",
  date_trunc('second', p.last_appointment)                 as "תור אחרון",
  count(a.id) filter (where a.status in ('booked','done')) as "סה""כ תורים",
  count(a.id) filter (where a.status = 'done')             as "בוצעו",
  count(a.id) filter (where a.status = 'cancelled')        as "בוטלו",
  p.id                                                     as "user_id"
from public.profiles p
left join public.appointments a on a.user_id = p.id
group by p.id
order by p.last_appointment desc nulls last;

-- ============================================================
--  Done. Tables: profiles, availability, appointments.
--  View: clients_report.
-- ============================================================
