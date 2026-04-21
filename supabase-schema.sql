-- Forge Fitness Journal — Supabase Schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query)

CREATE TABLE IF NOT EXISTS user_config (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  cfg          jsonb NOT NULL DEFAULT '{}',
  groups       jsonb NOT NULL DEFAULT '[]',
  machines     jsonb NOT NULL DEFAULT '[]',
  theme        text  NOT NULL DEFAULT 'dark',
  gamification jsonb NOT NULL DEFAULT '{}',
  updated_at   timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id           bigint PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date         date NOT NULL,
  started_at   timestamptz,
  saved_at     timestamptz NOT NULL DEFAULT now(),
  effort       smallint,
  duration     text,
  calories     numeric,
  calories_est boolean DEFAULT false,
  notes        text,
  cardio       jsonb,
  exercises    jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS sessions_user_date ON sessions(user_id, date DESC);

CREATE TABLE IF NOT EXISTS user_stats (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  data       jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz DEFAULT now()
);

-- Row Level Security: each user only sees their own data
ALTER TABLE user_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_stats  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own their config"   ON user_config FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own their sessions" ON sessions    FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own their stats"    ON user_stats  FOR ALL USING (auth.uid() = user_id);
