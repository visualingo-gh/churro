import { NextRequest, NextResponse } from 'next/server';
import { getRoomById, getGuessesByRoom, setRevealViewedAt, advanceRoomPhase } from '@/lib/db';
import { getGameWord, computeRevealData } from '@/lib/game-engine';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = req.nextUrl.searchParams.get('userId');

  const room = await getRoomById(id);
  if (!room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  }

  if (room.phase === 'contribution') {
    return NextResponse.json(
      { error: 'Reveal not available during contribution phase' },
      { status: 403 },
    );
  }

  const gameDate = room.game_date;
  const guesses = await getGuessesByRoom(id, gameDate);
  const secretWord = getGameWord(id, gameDate);

  const revealData = computeRevealData(
    guesses.filter(g => g.phase === 'contribution').map(g => g.guess),
    secretWord,
  );

  if (userId) {
    // Start solve timer for this user (idempotent — only sets once)
    await setRevealViewedAt(userId, id);

    // First user to view advances the room to final
    if (room.phase === 'reveal') {
      await advanceRoomPhase(id, 'reveal', 'final');
    }
  }

  return NextResponse.json({ revealData });
}
