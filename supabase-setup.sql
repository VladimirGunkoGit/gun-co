-- ================= gunco · схема БД для Supabase =================
-- Вставить целиком в Supabase → SQL Editor → RUN.
-- Создаёт таблицы задач, тегов и настроек с защитой (каждый видит только свои данные).

-- ---- ЗАДАЧИ ----
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  description text,
  due_date    date,
  due_time    text,
  notify      boolean default true,
  tag         text,
  is_done     boolean default false,
  created_at  timestamptz default now()
);
alter table public.tasks enable row level security;
drop policy if exists "tasks are private" on public.tasks;
create policy "tasks are private" on public.tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---- ТЕГИ ----
create table if not exists public.tags (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references auth.users(id) on delete cascade,
  name     text not null
);
alter table public.tags enable row level security;
drop policy if exists "tags are private" on public.tags;
create policy "tags are private" on public.tags
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---- НАСТРОЙКИ (тема, число задач на экране) ----
create table if not exists public.settings (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  theme    text default 'dark',
  count    integer default 5
);
alter table public.settings enable row level security;
drop policy if exists "settings are private" on public.settings;
create policy "settings are private" on public.settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
