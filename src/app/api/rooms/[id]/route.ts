import { NextRequest, NextResponse } from 'next/server';
import {
  getRoomById,
  getMembersByRoom,
  getGuessesByRoom,
  getResult,
  resetRoomForNewDay,
} from '@/lib/db';
import { getGameWord, computeRevealData, derivePlayerKnowledge } from '@/lib/game-engine';
import { getAppMode, getTodayStringLA } from '@/lib/app-mode';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = req.nextUrl.searchParams.get('userId');

  let room = await getRoomById(id);
  if (!room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  }

  // Lazy daily reset (daily mode only): new calendar day → new game
  if (getAppMode() === 'daily') {
    const today = getTodayStringLA();
    if (room.game_date < today) {
      await resetRoomForNewDay(id, today);
      room = { ...room, game_date: today, phase: 'contribution' };
    }
  }

  const [members, guesses, result] = await Promise.all([
    getMembersByRoom(id),
    getGuessesByRoom(id, room.game_date),
    getResult(id, room.game_date),
  ]);

  // Expose the answer only once the game is complete
  const answer = room.phase === 'complete'
    ? getGameWord(id, room.game_date)
    : null;

  // Compute per-user knowledge when in final or complete phase
  let knowledge = null;
  if (userId && (room.phase === 'final' || room.phase === 'complete')) {
    const secretWord = getGameWord(id, room.game_date);
    const seed = `${id}:${room.game_date}`;
    const contributionGuesses = guesses.filter(g => g.phase === 'contribution').map(g => g.guess);
    const revealData = computeRevealData(contributionGuesses, secretWord, seed);
    const userFinalGuesses = guesses
      .filter(g => g.user_id === userId && g.phase === 'final')
      .map(g => g.guess);
    knowledge = derivePlayerKnowledge(secretWord, revealData, userFinalGuesses);
  }

  return NextResponse.json({ room, members, guesses, result, answer, knowledge });
}
