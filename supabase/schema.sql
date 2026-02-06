-- Supabase schema for multi-user tracking data
-- Each table is scoped by user_id and protected by Row Level Security (RLS).

create extension if not exists "pgcrypto";

create table if not exists public.food_events (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  logged_at timestamptz not null,
  rollover_applied boolean not null default false,
  source text not null,
  description text,
  input_text text,
  notes text,
  nutrients jsonb,
  items jsonb,
  model text,
  confidence jsonb,
  applied_to_food_log boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists food_events_user_date on public.food_events(user_id, date);
create index if not exists food_events_user_logged_at on public.food_events(user_id, logged_at);

create table if not exists public.food_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  day_of_week text,
  weight_lb numeric,
  calories numeric,
  fat_g numeric,
  carbs_g numeric,
  protein_g numeric,
  fiber_g numeric,
  potassium_mg numeric,
  magnesium_mg numeric,
  omega3_mg numeric,
  calcium_mg numeric,
  iron_mg numeric,
  status text,
  notes text,
  healthy text,
  micronutrients jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

create index if not exists food_log_user_date on public.food_log(user_id, date);

create table if not exists public.fitness_current (
  user_id uuid primary key references auth.users(id) on delete cascade,
  week_start date not null,
  week_label text not null,
  summary text,
  cardio jsonb not null default '[]'::jsonb,
  strength jsonb not null default '[]'::jsonb,
  mobility jsonb not null default '[]'::jsonb,
  other jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.fitness_weeks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  week_label text not null,
  summary text,
  cardio jsonb not null default '[]'::jsonb,
  strength jsonb not null default '[]'::jsonb,
  mobility jsonb not null default '[]'::jsonb,
  other jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists fitness_weeks_user_start on public.fitness_weeks(user_id, week_start);

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  transition_context jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_rules (
  user_id uuid primary key references auth.users(id) on delete cascade,
  metadata jsonb not null default '{}'::jsonb,
  diet_philosophy jsonb not null default '{}'::jsonb,
  fitness_philosophy jsonb not null default '{}'::jsonb,
  extra jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- RLS
alter table public.food_events enable row level security;
alter table public.food_log enable row level security;
alter table public.fitness_current enable row level security;
alter table public.fitness_weeks enable row level security;
alter table public.user_profiles enable row level security;
alter table public.user_rules enable row level security;

create policy "food_events_select" on public.food_events
  for select using (auth.uid() = user_id);
create policy "food_events_insert" on public.food_events
  for insert with check (auth.uid() = user_id);
create policy "food_events_update" on public.food_events
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "food_events_delete" on public.food_events
  for delete using (auth.uid() = user_id);

create policy "food_log_select" on public.food_log
  for select using (auth.uid() = user_id);
create policy "food_log_insert" on public.food_log
  for insert with check (auth.uid() = user_id);
create policy "food_log_update" on public.food_log
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "food_log_delete" on public.food_log
  for delete using (auth.uid() = user_id);

create policy "fitness_current_select" on public.fitness_current
  for select using (auth.uid() = user_id);
create policy "fitness_current_insert" on public.fitness_current
  for insert with check (auth.uid() = user_id);
create policy "fitness_current_update" on public.fitness_current
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "fitness_current_delete" on public.fitness_current
  for delete using (auth.uid() = user_id);

create policy "fitness_weeks_select" on public.fitness_weeks
  for select using (auth.uid() = user_id);
create policy "fitness_weeks_insert" on public.fitness_weeks
  for insert with check (auth.uid() = user_id);
create policy "fitness_weeks_update" on public.fitness_weeks
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "fitness_weeks_delete" on public.fitness_weeks
  for delete using (auth.uid() = user_id);

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
