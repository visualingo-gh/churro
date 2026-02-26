-- ============================================================
-- Churro – Async Multiplayer Word Vault (V1)
-- Fresh install. Run in: Supabase Dashboard → SQL Editor
-- ============================================================

CREATE TYPE game_phase AS ENUM ('contribution', 'reveal', 'final', 'complete');

-- Persistent anonymous users (identity across rooms)
CREATE TABLE users (
  id           UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT  NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rooms: 2–4 players, daily word, room-scoped streak
CREATE TABLE rooms (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_code  TEXT        UNIQUE NOT NULL,
  max_players  INTEGER     NOT NULL DEFAULT 4 CHECK (max_players BETWEEN 2 AND 4),
  is_locked    BOOLEAN     NOT NULL DEFAULT FALSE,
  locked_at    TIMESTAMPTZ,
  phase        game_phase  NOT NULL DEFAULT 'contribution',
  streak_count INTEGER     NOT NULL DEFAULT 0,
  game_date    TEXT        NOT NULL, -- YYYY-MM-DD (UTC) of the active game
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Room membership (persists across days)
CREATE TABLE room_members (
  room_id          UUID        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name     TEXT        NOT NULL, -- denormalized for query simplicity
  joined_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reveal_viewed_at TIMESTAMPTZ,
  ready_for_next   BOOLEAN     NOT NULL DEFAULT FALSE, -- round mode: clicked "Start Next Word"
  PRIMARY KEY (room_id, user_id)
);

-- Guesses: scoped to a room + game_date
CREATE TABLE guesses (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id      UUID        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_date    TEXT        NOT NULL, -- YYYY-MM-DD
  phase        game_phase  NOT NULL,
  guess        TEXT        NOT NULL CHECK (char_length(guess) = 7),
  is_correct   BOOLEAN,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One contribution guess per user per room per day
CREATE UNIQUE INDEX one_contribution_per_user_per_game
  ON guesses(user_id, room_id, game_date)
  WHERE phase = 'contribution';

-- Results: one row per room per game day
CREATE TABLE results (
  room_id          UUID        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  game_date        TEXT        NOT NULL, -- YYYY-MM-DD
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
