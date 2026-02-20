-- Supabase schema for canonical simplified tracking data.
-- Runtime storage uses two user-scoped tables:
-- - public.user_profiles.user_profile (profile text mirror)
-- - public.user_rules.rules_data (canonical payload: profile/activity/food/rules)

create extension if not exists "pgcrypto";

-- Remove legacy per-domain tables from older app versions.
drop table if exists public.food_events cascade;
drop table if exists public.food_log cascade;
drop table if exists public.fitness_current cascade;
drop table if exists public.fitness_weeks cascade;
drop table if exists public.diet_days cascade;
drop table if exists public.training_blocks cascade;
drop table if exists public.training_weeks cascade;

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  user_profile jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_rules (
  user_id uuid primary key references auth.users(id) on delete cascade,
  rules_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_profiles add column if not exists user_profile jsonb not null default '{}'::jsonb;
alter table public.user_profiles add column if not exists updated_at timestamptz not null default now();
alter table public.user_rules add column if not exists rules_data jsonb not null default '{}'::jsonb;
alter table public.user_rules add column if not exists updated_at timestamptz not null default now();

alter table public.user_profiles enable row level security;
alter table public.user_rules enable row level security;

drop policy if exists "user_profiles_select" on public.user_profiles;
drop policy if exists "user_profiles_insert" on public.user_profiles;
drop policy if exists "user_profiles_update" on public.user_profiles;
drop policy if exists "user_profiles_delete" on public.user_profiles;

drop policy if exists "user_rules_select" on public.user_rules;
drop policy if exists "user_rules_insert" on public.user_rules;
drop policy if exists "user_rules_update" on public.user_rules;
drop policy if exists "user_rules_delete" on public.user_rules;

create policy "user_profiles_select" on public.user_profiles
  for select using (auth.uid() = user_id);
create policy "user_profiles_insert" on public.user_profiles
  for insert with check (auth.uid() = user_id);
create policy "user_profiles_update" on public.user_profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "user_profiles_delete" on public.user_profiles
  for delete using (auth.uid() = user_id);

create policy "user_rules_select" on public.user_rules
  for select using (auth.uid() = user_id);
create policy "user_rules_insert" on public.user_rules
  for insert with check (auth.uid() = user_id);
create policy "user_rules_update" on public.user_rules
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "user_rules_delete" on public.user_rules
  for delete using (auth.uid() = user_id);
