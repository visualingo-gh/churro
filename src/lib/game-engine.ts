import { getAnswerList } from './dictionary';
import type { Guess, PlayerKnowledge, RevealData } from '@/types/game';

// DJB2 hash — simple, deterministic, no dependencies
function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// Unified word selection — gameKey is either a round number string ("1", "2", …)
// or a date string ("2026-02-26"), depending on NEXT_PUBLIC_APP_MODE.
// Uses the curated answers list loaded from answers7.txt (server-only).
export function getGameWord(roomId: string, gameKey: string): string {
  const answers = getAnswerList();
  const seed = `${roomId}:${gameKey}`;
  return answers[djb2Hash(seed) % answers.length];
}

// Aggregates contribution guesses into the reveal payload.
// presentLetters / eliminatedLetters come from what players guessed.
// revealedPosition is a bonus hint — chosen deterministically from the secret word via the round seed.
export function computeRevealData(
  contributionGuesses: string[],
  secretWord: string,
  seed: string, // '{roomId}:{roundNumber}'
): RevealData {
  const secret = secretWord.toUpperCase();
  const secretSet = new Set(secret.split(''));

  const allGuessedLetters = new Set(
    contributionGuesses.flatMap(g => g.toUpperCase().split(''))
  );

  const presentLetters = [...allGuessedLetters].filter(l => secretSet.has(l)).sort();
  const eliminatedLetters = [...allGuessedLetters].filter(l => !secretSet.has(l)).sort();

  const posIndex = djb2Hash(seed) % secret.length;
  const revealedPosition = { index: posIndex, letter: secret[posIndex] };

  return { presentLetters, eliminatedLetters, revealedPosition };
}

export function validateGuess(guess: string): { valid: boolean; error?: string } {
  const cleaned = guess.trim().toUpperCase();
  if (cleaned.length !== 7) {
    return { valid: false, error: 'Guess must be exactly 7 letters' };
  }
  if (!/^[A-Z]+$/.test(cleaned)) {
    return { valid: false, error: 'Guess must contain only letters' };
  }
  return { valid: true };
}

export function isCorrectGuess(guess: string, secretWord: string): boolean {
  return guess.trim().toUpperCase() === secretWord.toUpperCase();
}

export function canSubmitFinalGuess(playerFinalGuessCount: number): boolean {
  return playerFinalGuessCount < 2;
}

// Returns true when the game should transition to 'complete'
export function shouldAdvanceToComplete(params: {
  members: { user_id: string }[];
  finalGuesses: Guess[];
}): boolean {
  const { members, finalGuesses } = params;

  if (finalGuesses.some(g => g.is_correct === true)) return true;

  return members.every(
    m => finalGuesses.filter(g => g.user_id === m.user_id).length >= 2
  );
}

export function computeRoundResult(params: {
  members: { user_id: string }[];
  finalGuesses: Guess[];
  contributionGuesses: Guess[];
}): {
  winnerUserId: string | null;
  solvedAt: string | null;
  allParticipated: boolean;
} {
  const { members, finalGuesses, contributionGuesses } = params;

  const participatingIds = new Set([
    ...contributionGuesses.map(g => g.user_id),
    ...finalGuesses.map(g => g.user_id),
  ]);
  const allParticipated = members.every(m => participatingIds.has(m.user_id));

  // Fastest correct solver wins
  const winner = finalGuesses
    .filter(g => g.is_correct === true)
    .sort((a, b) => new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime())[0];

  return {
    winnerUserId: winner?.user_id ?? null,
    solvedAt: winner?.submitted_at ?? null,
    allParticipated,
  };
}

// Accumulates per-player knowledge from reveal data + their final guesses.
// knownPositions is seeded from the revealed position hint, then each final
// guess fills any position where the guessed letter matches exactly.
export function derivePlayerKnowledge(
  answer: string,
  revealData: RevealData,
  finalGuesses: string[],
): PlayerKnowledge {
  const secret = answer.toUpperCase();
  const knownPositions: (string | null)[] = Array(7).fill(null);

  // Seed from the guaranteed reveal position
  knownPositions[revealData.revealedPosition.index] = revealData.revealedPosition.letter;

  // Accumulate present/eliminated from reveal data (baseline from contributions)
  const presentSet = new Set<string>(revealData.presentLetters);
  const eliminatedSet = new Set<string>(revealData.eliminatedLetters);

  // Each final guess: fill any position where the letter matches exactly,
  // and update the letter bank for all guessed letters.
  for (const guess of finalGuesses) {
    const g = guess.toUpperCase();
    for (let i = 0; i < 7; i++) {
      if (g[i] === secret[i]) knownPositions[i] = secret[i];
    }
    // Classify letters from this final guess against the answer
    for (const ch of g.split('')) {
      if (secret.includes(ch)) {
        presentSet.add(ch);
        eliminatedSet.delete(ch);
      } else {
        if (!presentSet.has(ch)) eliminatedSet.add(ch);
      }
    }
  }

  return {
    presentLetters: [...presentSet].sort(),
    eliminatedLetters: [...eliminatedSet].sort(),
    knownPositions,
  };
}

// Returns the member whose contribution guess shared the most letters with the answer.
// Ties broken by submission order (first-found wins).
export function computeBestContributor(
  contributionGuesses: Guess[],
  answer: string,
  members: { user_id: string; display_name: string }[],
): { userId: string; displayName: string } | null {
  const secret = new Set(answer.toUpperCase().split(''));
  let best: { userId: string; displayName: string } | null = null;
  let bestScore = 0;

  for (const g of contributionGuesses) {
    const score = g.guess.toUpperCase().split('').filter(ch => secret.has(ch)).length;
    if (score > bestScore) {
      bestScore = score;
      const member = members.find(m => m.user_id === g.user_id);
      if (member) best = { userId: member.user_id, displayName: member.display_name };
    }
  }

  return bestScore > 0 ? best : null;
}

// Formats elapsed time between two ISO strings as "Xm Ys" or "Xs".
export function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

// Streak rule: increase only if all participated AND someone solved.
// Reset to 0 if nobody solved. No change otherwise.
export function computeNewStreak(params: {
  currentStreak: number;
  winnerPlayerId: string | null;
  allParticipated: boolean;
}): number {
  const { currentStreak, winnerPlayerId, allParticipated } = params;
  if (winnerPlayerId && allParticipated) return currentStreak + 1;
  if (!winnerPlayerId) return 0;
  return currentStreak; // winner exists but not all participated
}
