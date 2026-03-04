import { supabase } from './supabase';
import type { GamePhase, Guess, Result, Room, RoomMember, User } from '@/types/game';

// ── Users ─────────────────────────────────────────────────────────────────────

export async function createUser(displayName: string): Promise<User> {
  const { data, error } = await supabase
    .from('users')
    .insert({ display_name: displayName })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as User;
}

export async function getUserById(id: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .single();
  if (error) return null;
  return data as User;
}

// ── Rooms ─────────────────────────────────────────────────────────────────────

export async function getRoomById(id: string): Promise<Room | null> {
  const { data, error } = await supabase
    .from('rooms')
    .select('*')
    .eq('id', id)
    .single();
  if (error) return null;
  return data as Room;
}

export async function createRoom(params: {
  inviteCode: string;
  maxPlayers: number;
  gameDate: string;
}): Promise<Room> {
  const { data, error } = await supabase
    .from('rooms')
    .insert({
      invite_code: params.inviteCode,
      max_players: params.maxPlayers,
      game_date: params.gameDate,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Room;
}

// Idempotent — only advances if room is still in fromPhase
export async function advanceRoomPhase(
  roomId: string,
  fromPhase: GamePhase,
  toPhase: GamePhase,
): Promise<void> {
  await supabase
    .from('rooms')
    .update({ phase: toPhase })
    .eq('id', roomId)
    .eq('phase', fromPhase);
}

// Update a member's last_action_at and refresh the room's expires_at window.
// Call on: begin game, contribution guess, final guess, ready/next-round.
export async function touchMemberActivity(userId: string, roomId: string): Promise<void> {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  await Promise.all([
    supabase
      .from('room_members')
      .update({ last_action_at: now })
      .eq('user_id', userId)
      .eq('room_id', roomId),
    supabase
      .from('rooms')
      .update({ expires_at: expiresAt })
      .eq('id', roomId),
  ]);
}

// Refresh the room's expires_at without targeting a specific member (e.g. on join).
export async function touchRoomActivity(roomId: string): Promise<void> {
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  await supabase
    .from('rooms')
    .update({ expires_at: expiresAt })
    .eq('id', roomId);
}

// Set phase = 'expired' if not already complete/expired.
// Safe for concurrent calls — second call updates 0 rows.
export async function expireRoom(roomId: string): Promise<void> {
  await supabase
    .from('rooms')
    .update({ phase: 'expired' })
    .eq('id', roomId)
    .neq('phase', 'complete')
    .neq('phase', 'expired');
}

// Soft-delete a room. Requires: ALTER TABLE rooms ADD COLUMN deleted_at timestamptz;
export async function softDeleteRoom(roomId: string): Promise<void> {
  const { error } = await supabase
    .from('rooms')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', roomId);
  if (error) throw new Error(error.message);
}

// Lock a room when it reaches max_players capacity
export async function lockRoom(roomId: string): Promise<void> {
  await supabase
    .from('rooms')
    .update({ is_locked: true, locked_at: new Date().toISOString() })
    .eq('id', roomId);
}

export async function updateStreakCount(roomId: string, streakCount: number): Promise<void> {
  await supabase
    .from('rooms')
    .update({ streak_count: streakCount })
    .eq('id', roomId);
}

// Lazy daily reset (daily mode): new calendar day → new game.
export async function resetRoomForNewDay(roomId: string, newDate: string): Promise<void> {
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  await supabase
    .from('rooms')
    .update({ phase: 'contribution', game_date: newDate, expires_at: expiresAt })
    .eq('id', roomId);

  await supabase
    .from('room_members')
    .update({ reveal_viewed_at: null, ready_for_next: false })
    .eq('room_id', roomId);
}

// Round mode: mark a member as ready for the next word.
export async function setMemberReady(userId: string, roomId: string): Promise<void> {
  await supabase
    .from('room_members')
    .update({ ready_for_next: true })
    .eq('user_id', userId)
    .eq('room_id', roomId);
}

// Round mode: clear a member's ready flag (called on advance failure so they can retry).
export async function resetMemberReady(userId: string, roomId: string): Promise<void> {
  await supabase
    .from('room_members')
    .update({ ready_for_next: false })
    .eq('user_id', userId)
    .eq('room_id', roomId);
}

// Round mode: advance to next round — increments game_date ("1" → "2"), resets phase.
// Idempotent: guarded by current game_date + phase so concurrent requests are no-ops.
export async function advanceToNextRound(roomId: string, currentGameDate: string): Promise<void> {
  const next = (parseInt(currentGameDate, 10) + 1).toString();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  const { error: roomError } = await supabase
    .from('rooms')
    .update({ phase: 'contribution', game_date: next, expires_at: expiresAt })
    .eq('id', roomId)
    .eq('game_date', currentGameDate)
    .in('phase', ['complete', 'expired']);
  if (roomError) throw new Error(roomError.message);

  const { error: membersError } = await supabase
    .from('room_members')
    .update({ reveal_viewed_at: null, ready_for_next: false })
    .eq('room_id', roomId);
  if (membersError) throw new Error(membersError.message);
}

// ── Room members ──────────────────────────────────────────────────────────────

export async function getMembersByRoom(roomId: string): Promise<RoomMember[]> {
  const { data, error } = await supabase
    .from('room_members')
    .select('*')
    .eq('room_id', roomId)
    .order('joined_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as RoomMember[];
}

export async function addMemberToRoom(params: {
  roomId: string;
  userId: string;
  displayName: string;
}): Promise<RoomMember> {
  const { data, error } = await supabase
    .from('room_members')
    .insert({
      room_id: params.roomId,
      user_id: params.userId,
      display_name: params.displayName,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as RoomMember;
}

// Only sets once — subsequent calls are no-ops (WHERE reveal_viewed_at IS NULL)
export async function setRevealViewedAt(userId: string, roomId: string): Promise<void> {
  await supabase
    .from('room_members')
    .update({ reveal_viewed_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('room_id', roomId)
    .is('reveal_viewed_at', null);
}

// Returns all non-deleted rooms a user belongs to, with room data + members + current result.
export async function getRoomsByUserId(userId: string): Promise<
  { room: Room; members: RoomMember[]; result: { winner_user_id: string | null } | null }[]
> {
  // 1. Get room IDs for this user
  const { data: memberships, error: mErr } = await supabase
    .from('room_members')
    .select('room_id')
    .eq('user_id', userId)
    .order('joined_at', { ascending: false });

  if (mErr || !memberships?.length) return [];

  const roomIds = memberships.map(m => m.room_id as string);

  // 2. Fetch rooms (excluding deleted) + all members + results in parallel
  const [{ data: rooms }, { data: allMembers }, { data: allResults }] = await Promise.all([
    supabase.from('rooms').select('*').in('id', roomIds).is('deleted_at', null),
    supabase.from('room_members').select('*').in('room_id', roomIds).order('joined_at', { ascending: true }),
    supabase.from('results').select('room_id, game_date, winner_user_id').in('room_id', roomIds),
  ]);

  if (!rooms) return [];

  return rooms.map(room => {
    const result = (allResults ?? []).find(
      r => r.room_id === room.id && r.game_date === (room as Room).game_date
    ) ?? null;
    return {
      room: room as Room,
      members: ((allMembers ?? []) as RoomMember[]).filter(m => m.room_id === room.id),
      result: result ? { winner_user_id: result.winner_user_id } : null,
    };
  });
}

// ── Guesses ───────────────────────────────────────────────────────────────────

export async function getGuessesByRoom(roomId: string, gameDate: string): Promise<Guess[]> {
  const { data, error } = await supabase
    .from('guesses')
    .select('*')
    .eq('room_id', roomId)
    .eq('game_date', gameDate)
    .order('submitted_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Guess[];
}

export async function insertGuess(params: {
  roomId: string;
  userId: string;
  gameDate: string;
  phase: 'contribution' | 'final';
  guess: string;
  isCorrect: boolean | null;
}): Promise<Guess> {
  const { data, error } = await supabase
    .from('guesses')
    .insert({
      room_id: params.roomId,
      user_id: params.userId,
      game_date: params.gameDate,
      phase: params.phase,
      guess: params.guess.toUpperCase(),
      is_correct: params.isCorrect,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Guess;
}

// ── Results ───────────────────────────────────────────────────────────────────

export async function getResult(roomId: string, gameDate: string): Promise<Result | null> {
  const { data, error } = await supabase
    .from('results')
    .select('*')
    .eq('room_id', roomId)
    .eq('game_date', gameDate)
    .single();
  if (error) return null;
  return data as Result;
}

export async function insertResult(params: {
  roomId: string;
  gameDate: string;
  winnerUserId: string | null;
  solvedAt: string | null;
  allParticipated: boolean;
}): Promise<void> {
  const { error } = await supabase
    .from('results')
    .upsert(
      {
        room_id: params.roomId,
        game_date: params.gameDate,
        winner_user_id: params.winnerUserId,
        solved_at: params.solvedAt,
        all_participated: params.allParticipated,
      },
      { onConflict: 'room_id,game_date' },
    );
  if (error) throw new Error(error.message);
}
