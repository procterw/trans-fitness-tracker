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
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

create index if not exists food_log_user_date on public.food_log(user_id, date);

-- Ensure canonical micronutrient columns exist and migrate away from legacy food_log.micronutrients jsonb.
alter table public.food_log add column if not exists fiber_g numeric;
alter table public.food_log add column if not exists potassium_mg numeric;
alter table public.food_log add column if not exists magnesium_mg numeric;
alter table public.food_log add column if not exists omega3_mg numeric;
alter table public.food_log add column if not exists calcium_mg numeric;
alter table public.food_log add column if not exists iron_mg numeric;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'food_log' and column_name = 'micronutrients'
  ) then
    execute $sql$
      update public.food_log
      set fiber_g = coalesce(
            fiber_g,
            case
              when btrim(micronutrients->>'fiber_g') ~ '^[+-]?([0-9]+([.][0-9]+)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
              then (micronutrients->>'fiber_g')::numeric
              else null
            end
          ),
          potassium_mg = coalesce(
            potassium_mg,
            case
              when btrim(micronutrients->>'potassium_mg') ~ '^[+-]?([0-9]+([.][0-9]+)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
              then (micronutrients->>'potassium_mg')::numeric
              else null
            end
          ),
          magnesium_mg = coalesce(
            magnesium_mg,
            case
              when btrim(micronutrients->>'magnesium_mg') ~ '^[+-]?([0-9]+([.][0-9]+)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
              then (micronutrients->>'magnesium_mg')::numeric
              else null
            end
          ),
          omega3_mg = coalesce(
            omega3_mg,
            case
              when btrim(micronutrients->>'omega3_mg') ~ '^[+-]?([0-9]+([.][0-9]+)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
              then (micronutrients->>'omega3_mg')::numeric
              else null
            end
          ),
          calcium_mg = coalesce(
            calcium_mg,
            case
              when btrim(micronutrients->>'calcium_mg') ~ '^[+-]?([0-9]+([.][0-9]+)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
              then (micronutrients->>'calcium_mg')::numeric
              else null
            end
          ),
          iron_mg = coalesce(
            iron_mg,
            case
              when btrim(micronutrients->>'iron_mg') ~ '^[+-]?([0-9]+([.][0-9]+)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
              then (micronutrients->>'iron_mg')::numeric
              else null
            end
          )
      where micronutrients is not null
        and jsonb_typeof(micronutrients) = 'object'
    $sql$;

    execute 'alter table public.food_log drop column if exists micronutrients';
  end if;
end $$;

create table if not exists public.fitness_current (
  user_id uuid primary key references auth.users(id) on delete cascade,
  week_start date not null,
  week_label text not null,
  summary text,
  checklist jsonb not null default '{}'::jsonb,
  category_order jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.fitness_weeks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  week_label text not null,
  summary text,
  checklist jsonb not null default '{}'::jsonb,
  category_order jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists fitness_weeks_user_start on public.fitness_weeks(user_id, week_start);

-- Add flexible checklist columns for existing installs and backfill from legacy fixed columns when present.
alter table public.fitness_current add column if not exists checklist jsonb not null default '{}'::jsonb;
alter table public.fitness_current add column if not exists category_order jsonb not null default '[]'::jsonb;
alter table public.fitness_weeks add column if not exists checklist jsonb not null default '{}'::jsonb;
alter table public.fitness_weeks add column if not exists category_order jsonb not null default '[]'::jsonb;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'fitness_current' and column_name = 'cardio'
  ) then
    execute $sql$
      update public.fitness_current
      set checklist = jsonb_strip_nulls(
            jsonb_build_object(
              'cardio', cardio,
              'strength', strength,
              'mobility', mobility,
              'other', other
            )
          ),
          category_order = case
            when jsonb_typeof(category_order) = 'array' and jsonb_array_length(category_order) > 0 then category_order
            else '["cardio","strength","mobility","other"]'::jsonb
          end
      where checklist = '{}'::jsonb
        and (
          coalesce(jsonb_array_length(cardio), 0) +
          coalesce(jsonb_array_length(strength), 0) +
          coalesce(jsonb_array_length(mobility), 0) +
          coalesce(jsonb_array_length(other), 0)
        ) > 0
    $sql$;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'fitness_weeks' and column_name = 'cardio'
  ) then
    execute $sql$
      update public.fitness_weeks
      set checklist = jsonb_strip_nulls(
            jsonb_build_object(
              'cardio', cardio,
              'strength', strength,
              'mobility', mobility,
              'other', other
            )
          ),
          category_order = case
            when jsonb_typeof(category_order) = 'array' and jsonb_array_length(category_order) > 0 then category_order
            else '["cardio","strength","mobility","other"]'::jsonb
          end
      where checklist = '{}'::jsonb
        and (
          coalesce(jsonb_array_length(cardio), 0) +
          coalesce(jsonb_array_length(strength), 0) +
          coalesce(jsonb_array_length(mobility), 0) +
          coalesce(jsonb_array_length(other), 0)
        ) > 0
    $sql$;
  end if;
end $$;

-- Remove legacy fixed checklist columns once values have been backfilled into checklist/category_order.
alter table public.fitness_current drop column if exists cardio;
alter table public.fitness_current drop column if exists strength;
alter table public.fitness_current drop column if exists mobility;
alter table public.fitness_current drop column if exists other;
alter table public.fitness_weeks drop column if exists cardio;
alter table public.fitness_weeks drop column if exists strength;
alter table public.fitness_weeks drop column if exists mobility;
alter table public.fitness_weeks drop column if exists other;

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  user_profile jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_profiles add column if not exists user_profile jsonb not null default '{}'::jsonb;

create table if not exists public.user_rules (
  user_id uuid primary key references auth.users(id) on delete cascade,
  rules_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_rules add column if not exists rules_data jsonb not null default '{}'::jsonb;

-- Assistant/rules configuration is stored per-user in public.user_rules (rules_data jsonb).

-- RLS
alter table public.food_events enable row level security;
alter table public.food_log enable row level security;
alter table public.fitness_current enable row level security;
alter table public.fitness_weeks enable row level security;
alter table public.user_profiles enable row level security;
alter table public.user_rules enable row level security;

drop policy if exists "food_events_select" on public.food_events;
drop policy if exists "food_events_insert" on public.food_events;
drop policy if exists "food_events_update" on public.food_events;
drop policy if exists "food_events_delete" on public.food_events;

drop policy if exists "food_log_select" on public.food_log;
drop policy if exists "food_log_insert" on public.food_log;
drop policy if exists "food_log_update" on public.food_log;
drop policy if exists "food_log_delete" on public.food_log;

drop policy if exists "fitness_current_select" on public.fitness_current;
drop policy if exists "fitness_current_insert" on public.fitness_current;
drop policy if exists "fitness_current_update" on public.fitness_current;
drop policy if exists "fitness_current_delete" on public.fitness_current;

drop policy if exists "fitness_weeks_select" on public.fitness_weeks;
drop policy if exists "fitness_weeks_insert" on public.fitness_weeks;
drop policy if exists "fitness_weeks_update" on public.fitness_weeks;
drop policy if exists "fitness_weeks_delete" on public.fitness_weeks;

drop policy if exists "user_profiles_select" on public.user_profiles;
drop policy if exists "user_profiles_insert" on public.user_profiles;
drop policy if exists "user_profiles_update" on public.user_profiles;
drop policy if exists "user_profiles_delete" on public.user_profiles;

drop policy if exists "user_rules_select" on public.user_rules;
drop policy if exists "user_rules_insert" on public.user_rules;
drop policy if exists "user_rules_update" on public.user_rules;
drop policy if exists "user_rules_delete" on public.user_rules;

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
