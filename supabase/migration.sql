-- ============================================================
-- Churro – Migration to V1 daily / user model
-- !! Drops all existing game data. Safe for dev. !!
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Drop old tables (cascade removes indexes + constraints)
DROP TABLE IF EXISTS results  CASCADE;
DROP TABLE IF EXISTS guesses  CASCADE;
DROP TABLE IF EXISTS players  CASCADE;
DROP TABLE IF EXISTS rooms    CASCADE;
DROP TABLE IF EXISTS users    CASCADE;
DROP TYPE  IF EXISTS game_phase CASCADE;

-- Recreate everything clean
CREATE TYPE game_phase AS ENUM ('contribution', 'reveal', 'final', 'complete');

CREATE TABLE users (
  id           UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT  NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE rooms (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_code  TEXT        UNIQUE NOT NULL,
  max_players  INTEGER     NOT NULL DEFAULT 4 CHECK (max_players BETWEEN 2 AND 4),
  is_locked    BOOLEAN     NOT NULL DEFAULT FALSE,
  locked_at    TIMESTAMPTZ,
  phase        game_phase  NOT NULL DEFAULT 'contribution',
  streak_count INTEGER     NOT NULL DEFAULT 0,
  game_date    TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE room_members (
  room_id          UUID        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name     TEXT        NOT NULL,
  joined_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reveal_viewed_at TIMESTAMPTZ,
  ready_for_next   BOOLEAN     NOT NULL DEFAULT FALSE,
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE guesses (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id      UUID        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_date    TEXT        NOT NULL,
  phase        game_phase  NOT NULL,
  guess        TEXT        NOT NULL CHECK (char_length(guess) = 7),
  is_correct   BOOLEAN,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX one_contribution_per_user_per_game
  ON guesses(user_id, room_id, game_date)
  WHERE phase = 'contribution';

CREATE TABLE results (
  room_id          UUID        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  game_date        TEXT        NOT NULL,
  winner_user_id   UUID        REFERENCES users(id),
  solved_at        TIMESTAMPTZ,
  all_participated BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, game_date)
);

CREATE INDEX idx_room_members_user  ON room_members(user_id);
CREATE INDEX idx_room_members_room  ON room_members(room_id);
CREATE INDEX idx_guesses_room_date  ON guesses(room_id, game_date);
CREATE INDEX idx_guesses_user       ON guesses(user_id);
