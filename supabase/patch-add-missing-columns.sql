-- ============================================================
-- Churro – Patch: add columns + enum values added after V1
-- Safe to run on an existing DB (uses IF NOT EXISTS / DO blocks).
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- 1. Add 'expired' to game_phase enum (idempotent via DO block)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'expired'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'game_phase')
  ) THEN
    ALTER TYPE game_phase ADD VALUE 'expired';
  END IF;
END
$$;

-- 2. Add expires_at to rooms (activity-based expiry window)
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- 3. Add deleted_at to rooms (soft-delete)
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 4. Add last_action_at to room_members (presence / last-active display)
ALTER TABLE room_members ADD COLUMN IF NOT EXISTS last_action_at TIMESTAMPTZ;
