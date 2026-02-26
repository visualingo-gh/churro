import { NextRequest, NextResponse } from 'next/server';
import {
  getRoomById,
  getMembersByRoom,
  getGuessesByRoom,
  insertGuess,
  advanceRoomPhase,
  insertResult,
  updateStreakCount,
} from '@/lib/db';
import {
  getGameWord,
  validateGuess,
  isCorrectGuess,
  canSubmitFinalGuess,
  shouldAdvanceToComplete,
  computeRoundResult,
  computeNewStreak,
  computeRevealData,
  derivePlayerKnowledge,
} from '@/lib/game-engine';
import { isValidWord } from '@/lib/dictionary';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { userId, guess } = body ?? {};

  if (!userId || !guess) {
    return NextResponse.json({ error: 'userId and guess are required' }, { status: 400 });
  }

  // Validation order: format → dictionary
  const validation = validateGuess(guess);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const normalized = guess.trim().toUpperCase();

  if (!isValidWord(normalized)) {
    return NextResponse.json({ error: 'Invalid word' }, { status: 400 });
  }

  const room = await getRoomById(id);
  if (!room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  }

  const members = await getMembersByRoom(id);
  if (!members.find(m => m.user_id === userId)) {
    return NextResponse.json({ error: 'Not a member of this room' }, { status: 403 });
  }

  const gameDate = room.game_date;
  const guesses = await getGuessesByRoom(id, gameDate);

  // ── CONTRIBUTION ──────────────────────────────────────────────────────────
  if (room.phase === 'contribution') {
    if (!room.is_locked) {
      return NextResponse.json({ error: 'Game has not started yet' }, { status: 400 });
    }

    const alreadySubmitted = guesses.some(
      g => g.user_id === userId && g.phase === 'contribution'
    );
    if (alreadySubmitted) {
      return NextResponse.json({ error: 'Already submitted contribution guess' }, { status: 409 });
    }

    await insertGuess({
      roomId: id, userId, gameDate,
      phase: 'contribution', guess: normalized, isCorrect: null,
    });

    // Advance when all members have contributed
    const contributionCount = guesses.filter(g => g.phase === 'contribution').length + 1;
    if (contributionCount >= members.length) {
      await advanceRoomPhase(id, 'contribution', 'reveal');
    }

    return NextResponse.json({ success: true });
  }

  // ── FINAL ─────────────────────────────────────────────────────────────────
  if (room.phase === 'final') {
    const userFinalGuesses = guesses.filter(
      g => g.user_id === userId && g.phase === 'final'
    );

    if (!canSubmitFinalGuess(userFinalGuesses.length)) {
      return NextResponse.json({ error: 'No final guesses remaining' }, { status: 400 });
    }

    const secretWord = getGameWord(id, gameDate);
    const correct = isCorrectGuess(normalized, secretWord);

    await insertGuess({
      roomId: id, userId, gameDate,
      phase: 'final', guess: normalized, isCorrect: correct,
    });

    // Re-fetch to include the just-inserted guess
    const allGuesses = await getGuessesByRoom(id, gameDate);
    const allFinalGuesses = allGuesses.filter(g => g.phase === 'final');

    if (shouldAdvanceToComplete({ members, finalGuesses: allFinalGuesses })) {
      await advanceRoomPhase(id, 'final', 'complete');

      const result = computeRoundResult({
        members,
        finalGuesses: allFinalGuesses,
        contributionGuesses: allGuesses.filter(g => g.phase === 'contribution'),
      });

      const newStreak = computeNewStreak({
        currentStreak: room.streak_count,
        winnerPlayerId: result.winnerUserId,
        allParticipated: result.allParticipated,
      });

      await Promise.all([
        insertResult({
          roomId: id,
          gameDate,
          winnerUserId: result.winnerUserId,
          solvedAt: result.solvedAt,
          allParticipated: result.allParticipated,
        }),
        updateStreakCount(id, newStreak),
      ]);
    }

    // Compute updated knowledge for this user after their guess
    const allGuessesAfter = await getGuessesByRoom(id, gameDate);
    const seed = `${id}:${gameDate}`;
    const contributionWords = allGuessesAfter.filter(g => g.phase === 'contribution').map(g => g.guess);
    const revealData = computeRevealData(contributionWords, secretWord, seed);
    const userFinalWords = allGuessesAfter
      .filter(g => g.user_id === userId && g.phase === 'final')
      .map(g => g.guess);
    const knowledge = derivePlayerKnowledge(secretWord, revealData, userFinalWords);

    return NextResponse.json({ success: true, correct, knowledge });
  }

  return NextResponse.json(
    { error: `Cannot submit guess in phase: ${room.phase}` },
    { status: 400 },
  );
}
