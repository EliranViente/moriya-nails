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
  id                uuid primary key references auth.users(id) on delete cascade,
  email             text,
  full_name         text,
  phone             text,
  phone_verified    boolean     not null default false,
  phone_verified_at timestamptz,
  created_at        timestamptz default now()
);

-- For existing databases created before phone verification was added:
alter table public.profiles add column if not exists phone_verified    boolean     not null default false;
alter table public.profiles add column if not exists phone_verified_at timestamptz;

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

-- ============================================================
--  2) AVAILABILITY – open working windows (admin-managed)
--     Admin adds e.g. date=2026-06-26, 09:00–17:00 → opens slots
-- ============================================================
create table if not exists public.availability (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  start_time  time not null,
  end_time    time not null,
  created_at  timestamptz default now()
);
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
--  4) PHONE VERIFICATIONS – short-lived OTP codes (server-only)
--     Written/read exclusively by the serverless functions via the
--     service-role key. RLS is enabled with NO policies, so the
--     anon/authenticated clients can never read or write codes.
-- ============================================================
create table if not exists public.phone_verifications (
  phone        text primary key,          -- E.164, e.g. +972501234567
  code_hash    text        not null,      -- sha256(code + secret)
  expires_at   timestamptz not null,
  attempts     int         not null default 0,
  last_sent_at timestamptz not null default now()
);

-- ============================================================
--  Guard: only the service role may flip phone_verified.
--  A logged-in client updating its own profile (anon key) keeps the
--  previous verification state, so the flag can't be forged.
-- ============================================================
create or replace function public.guard_phone_verified()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    new.phone_verified    := old.phone_verified;
    new.phone_verified_at := old.phone_verified_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_phone_verified on public.profiles;
create trigger trg_guard_phone_verified
  before update on public.profiles
  for each row execute function public.guard_phone_verified();

-- ============================================================
--  ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles           enable row level security;
alter table public.availability       enable row level security;
alter table public.appointments       enable row level security;
alter table public.phone_verifications enable row level security;
-- NOTE: phone_verifications intentionally has NO policies → only the
-- service-role key (used by the serverless functions) can touch it.

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
--  Done. Tables: profiles, availability, appointments.
-- ============================================================
