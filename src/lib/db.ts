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
  await supabase
    .from('rooms')
    .update({ phase: 'contribution', game_date: newDate })
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

// Round mode: advance to next round — increments game_date ("1" → "2"), resets phase.
// Idempotent: guarded by current game_date + phase so concurrent requests are no-ops.
export async function advanceToNextRound(roomId: string, currentGameDate: string): Promise<void> {
  const next = (parseInt(currentGameDate, 10) + 1).toString();

  await supabase
    .from('rooms')
    .update({ phase: 'contribution', game_date: next })
    .eq('id', roomId)
    .eq('game_date', currentGameDate)
    .eq('phase', 'complete');

  await supabase
    .from('room_members')
    .update({ reveal_viewed_at: null, ready_for_next: false })
    .eq('room_id', roomId);
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

// Returns all rooms a user belongs to, with full room data + member list
export async function getRoomsByUserId(userId: string): Promise<
  { room: Room; members: RoomMember[] }[]
> {
  // 1. Get room IDs for this user
  const { data: memberships, error: mErr } = await supabase
    .from('room_members')
    .select('room_id')
    .eq('user_id', userId)
    .order('joined_at', { ascending: false });

  if (mErr || !memberships?.length) return [];

  const roomIds = memberships.map(m => m.room_id as string);

  // 2. Fetch rooms + all members in parallel
  const [{ data: rooms }, { data: allMembers }] = await Promise.all([
    supabase.from('rooms').select('*').in('id', roomIds),
    supabase.from('room_members').select('*').in('room_id', roomIds).order('joined_at', { ascending: true }),
  ]);

  if (!rooms) return [];

  return rooms.map(room => ({
    room: room as Room,
    members: ((allMembers ?? []) as RoomMember[]).filter(m => m.room_id === room.id),
  }));
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
