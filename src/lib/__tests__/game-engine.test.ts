import { vi, describe, it, expect } from 'vitest';
import type { Guess } from '@/types/game';

// Must be hoisted before importing game-engine (which imports dictionary at module load)
vi.mock('../dictionary', () => ({
  getAnswerList: () => [
    'BROUGHT',
    'CLAIMED',
    'DARKENS',
    'FLIGHTS',
    'GRABBED',
    'HUNTERS',
    'JANGLED',
  ],
}));

import {
  getGameWord,
  computeRevealData,
  validateGuess,
  isCorrectGuess,
  canSubmitFinalGuess,
  shouldAdvanceToComplete,
  computeRoundResult,
  derivePlayerKnowledge,
  computeBestContributor,
  formatDuration,
  computeNewStreak,
} from '../game-engine';
import { GAME_CONFIG } from '../game-config';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeGuess(overrides: Partial<Guess> = {}): Guess {
  return {
    id: 'g1',
    room_id: 'room-1',
    user_id: 'user-1',
    game_date: '1',
    phase: 'final',
    guess: 'BROUGHT',
    is_correct: null,
    submitted_at: '2026-03-03T10:00:00.000Z',
    ...overrides,
  };
}

function makeMember(userId: string) {
  return { user_id: userId, display_name: `Player ${userId}` };
}

const MOCK_ANSWERS = ['BROUGHT', 'CLAIMED', 'DARKENS', 'FLIGHTS', 'GRABBED', 'HUNTERS', 'JANGLED'];

// ─── getGameWord ──────────────────────────────────────────────────────────────

describe('getGameWord', () => {
  it('returns a word from the answer list', () => {
    const word = getGameWord('room-1', '1');
    expect(MOCK_ANSWERS).toContain(word);
  });

  it('is deterministic — same inputs always return the same word', () => {
    expect(getGameWord('room-1', '1')).toBe(getGameWord('room-1', '1'));
    expect(getGameWord('room-abc', '2026-03-03')).toBe(getGameWord('room-abc', '2026-03-03'));
  });

  it('produces different words for different room IDs', () => {
    // With 7 words, collision probability is low across these IDs
    const results = new Set(['room-A', 'room-B', 'room-C', 'room-D'].map(id => getGameWord(id, '1')));
    expect(results.size).toBeGreaterThan(1);
  });

  it('produces different words for different game keys', () => {
    const results = new Set(['1', '2', '3', '4'].map(key => getGameWord('room-1', key)));
    expect(results.size).toBeGreaterThan(1);
  });
});

// ─── validateGuess ────────────────────────────────────────────────────────────

describe('validateGuess', () => {
  it('accepts a valid 7-letter uppercase word', () => {
    expect(validateGuess('BROUGHT').valid).toBe(true);
  });

  it('accepts a valid 7-letter lowercase word (normalised)', () => {
    expect(validateGuess('brought').valid).toBe(true);
  });

  it('accepts a valid 7-letter mixed-case word', () => {
    expect(validateGuess('BrOuGhT').valid).toBe(true);
  });

  it('rejects a word that is too short', () => {
    const result = validateGuess('HELP');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/7/);
  });

  it('rejects a word that is too long', () => {
    const result = validateGuess('TOOLONGWORD');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/7/);
  });

  it('rejects a word containing non-alpha characters', () => {
    const result = validateGuess('HELLO-1');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/letters/i);
  });

  it('rejects an empty string', () => {
    expect(validateGuess('').valid).toBe(false);
  });

  it('trims surrounding whitespace before validating', () => {
    expect(validateGuess('  BROUGHT  ').valid).toBe(true);
  });
});

// ─── isCorrectGuess ───────────────────────────────────────────────────────────

describe('isCorrectGuess', () => {
  it('returns true for an exact match', () => {
    expect(isCorrectGuess('BROUGHT', 'BROUGHT')).toBe(true);
  });

  it('returns true regardless of case in guess', () => {
    expect(isCorrectGuess('brought', 'BROUGHT')).toBe(true);
  });

  it('returns true regardless of case in secret', () => {
    expect(isCorrectGuess('BROUGHT', 'brought')).toBe(true);
  });

  it('returns false for a wrong word', () => {
    expect(isCorrectGuess('CLAIMED', 'BROUGHT')).toBe(false);
  });

  it('trims whitespace before comparing', () => {
    expect(isCorrectGuess('  BROUGHT  ', 'BROUGHT')).toBe(true);
  });
});

// ─── canSubmitFinalGuess ──────────────────────────────────────────────────────

describe('canSubmitFinalGuess', () => {
  it('allows submission at 0 guesses used', () => {
    expect(canSubmitFinalGuess(0)).toBe(true);
  });

  it('allows submission when below the limit', () => {
    expect(canSubmitFinalGuess(GAME_CONFIG.finalGuesses - 1)).toBe(true);
  });

  it('blocks submission at the exact limit', () => {
    expect(canSubmitFinalGuess(GAME_CONFIG.finalGuesses)).toBe(false);
  });

  it('blocks submission above the limit', () => {
    expect(canSubmitFinalGuess(GAME_CONFIG.finalGuesses + 1)).toBe(false);
  });
});

// ─── shouldAdvanceToComplete ──────────────────────────────────────────────────

describe('shouldAdvanceToComplete', () => {
  const members = [makeMember('u1'), makeMember('u2')];

  it('returns true immediately when any guess is correct', () => {
    const finalGuesses = [
      makeGuess({ user_id: 'u1', is_correct: true }),
    ];
    expect(shouldAdvanceToComplete({ members, finalGuesses })).toBe(true);
  });

  it('returns true when only one of many players has a correct guess', () => {
    const finalGuesses = [
      makeGuess({ user_id: 'u1', is_correct: false }),
      makeGuess({ user_id: 'u2', is_correct: true }),
    ];
    expect(shouldAdvanceToComplete({ members, finalGuesses })).toBe(true);
  });

  it('does NOT return true when is_correct is null (pending)', () => {
    const finalGuesses = Array(GAME_CONFIG.finalGuesses).fill(null).map((_, i) =>
      makeGuess({ id: `g${i}`, user_id: 'u1', is_correct: null })
    );
    expect(shouldAdvanceToComplete({ members, finalGuesses })).toBe(false);
  });

  it('does NOT return true when is_correct is false', () => {
    const guesses = [makeGuess({ user_id: 'u1', is_correct: false })];
    expect(shouldAdvanceToComplete({ members, finalGuesses: guesses })).toBe(false);
  });

  it('returns true when all players have exhausted their guesses', () => {
    const finalGuesses = [
      ...Array(GAME_CONFIG.finalGuesses).fill(null).map((_, i) =>
        makeGuess({ id: `g_u1_${i}`, user_id: 'u1', is_correct: false })
      ),
      ...Array(GAME_CONFIG.finalGuesses).fill(null).map((_, i) =>
        makeGuess({ id: `g_u2_${i}`, user_id: 'u2', is_correct: false })
      ),
    ];
    expect(shouldAdvanceToComplete({ members, finalGuesses })).toBe(true);
  });

  it('returns false when one player is exhausted but another still has guesses', () => {
    const finalGuesses = Array(GAME_CONFIG.finalGuesses).fill(null).map((_, i) =>
      makeGuess({ id: `g${i}`, user_id: 'u1', is_correct: false })
    );
    // u2 has zero guesses
    expect(shouldAdvanceToComplete({ members, finalGuesses })).toBe(false);
  });

  it('returns false with no guesses at all', () => {
    expect(shouldAdvanceToComplete({ members, finalGuesses: [] })).toBe(false);
  });

  it('returns true for a solo vault when the single player exhausts guesses', () => {
    const solo = [makeMember('u1')];
    const finalGuesses = Array(GAME_CONFIG.finalGuesses).fill(null).map((_, i) =>
      makeGuess({ id: `g${i}`, user_id: 'u1', is_correct: false })
    );
    expect(shouldAdvanceToComplete({ members: solo, finalGuesses })).toBe(true);
  });
});

// ─── computeRoundResult ───────────────────────────────────────────────────────

describe('computeRoundResult', () => {
  const members = [makeMember('u1'), makeMember('u2')];

  it('returns the correct player as winner', () => {
    const finalGuesses = [
      makeGuess({ user_id: 'u1', is_correct: true, submitted_at: '2026-03-03T10:05:00.000Z' }),
    ];
    const { winnerUserId, solvedAt } = computeRoundResult({ members, finalGuesses, contributionGuesses: [] });
    expect(winnerUserId).toBe('u1');
    expect(solvedAt).toBe('2026-03-03T10:05:00.000Z');
  });

  it('picks the earliest correct guess when multiple players solve', () => {
    const finalGuesses = [
      makeGuess({ id: 'g1', user_id: 'u1', is_correct: true, submitted_at: '2026-03-03T10:05:00.000Z' }),
      makeGuess({ id: 'g2', user_id: 'u2', is_correct: true, submitted_at: '2026-03-03T10:04:00.000Z' }),
    ];
    const { winnerUserId } = computeRoundResult({ members, finalGuesses, contributionGuesses: [] });
    expect(winnerUserId).toBe('u2'); // u2 was earlier
  });

  it('returns null winner when no correct guesses', () => {
    const finalGuesses = [
      makeGuess({ user_id: 'u1', is_correct: false }),
    ];
    const { winnerUserId, solvedAt } = computeRoundResult({ members, finalGuesses, contributionGuesses: [] });
    expect(winnerUserId).toBeNull();
    expect(solvedAt).toBeNull();
  });

  it('ignores is_correct === null when finding winner', () => {
    const finalGuesses = [makeGuess({ user_id: 'u1', is_correct: null })];
    const { winnerUserId } = computeRoundResult({ members, finalGuesses, contributionGuesses: [] });
    expect(winnerUserId).toBeNull();
  });

  it('marks allParticipated true when every member has at least one guess', () => {
    const finalGuesses = [
      makeGuess({ id: 'g1', user_id: 'u1', is_correct: false }),
      makeGuess({ id: 'g2', user_id: 'u2', is_correct: false }),
    ];
    const { allParticipated } = computeRoundResult({ members, finalGuesses, contributionGuesses: [] });
    expect(allParticipated).toBe(true);
  });

  it('marks allParticipated false when a member has no guesses in either phase', () => {
    // only u1 guessed; u2 never submitted anything
    const finalGuesses = [makeGuess({ user_id: 'u1', is_correct: false })];
    const { allParticipated } = computeRoundResult({ members, finalGuesses, contributionGuesses: [] });
    expect(allParticipated).toBe(false);
  });

  it('counts contribution guesses toward allParticipated', () => {
    // u2 only has a contribution guess, no final guess
    const contributionGuesses = [makeGuess({ user_id: 'u2', phase: 'contribution' })];
    const finalGuesses = [makeGuess({ user_id: 'u1', is_correct: false })];
    const { allParticipated } = computeRoundResult({ members, finalGuesses, contributionGuesses });
    expect(allParticipated).toBe(true);
  });

  it('returns allParticipated true with no members', () => {
    // every() on empty array returns true
    const { allParticipated } = computeRoundResult({ members: [], finalGuesses: [], contributionGuesses: [] });
    expect(allParticipated).toBe(true);
  });
});

// ─── computeRevealData ────────────────────────────────────────────────────────

describe('computeRevealData', () => {
  const SECRET = 'BROUGHT'; // B R O U G H T

  it('identifies letters that are in the secret word as present', () => {
    const { presentLetters } = computeRevealData(['BROWSER'], SECRET);
    // B, R, O are in BROUGHT
    expect(presentLetters).toContain('B');
    expect(presentLetters).toContain('R');
    expect(presentLetters).toContain('O');
  });

  it('identifies letters not in the secret word as eliminated', () => {
    const { eliminatedLetters } = computeRevealData(['AAAAAAZ'], SECRET);
    expect(eliminatedLetters).toContain('A');
    expect(eliminatedLetters).toContain('Z');
  });

  it('detects exact-position matches in knownPositions', () => {
    // BROUGHT: B(0) R(1) O(2) U(3) G(4) H(5) T(6)
    // A guess starting with B matches position 0
    const { knownPositions } = computeRevealData(['BURNING'], SECRET); // B matches pos 0
    expect(knownPositions[0]).toBe('B');
  });

  it('leaves non-matching positions as null', () => {
    const { knownPositions } = computeRevealData(['AAAAAAA'], SECRET);
    expect(knownPositions.every(p => p === null)).toBe(true);
  });

  it('accumulates known positions across multiple contribution guesses', () => {
    // First guess hits position 0 (B), second hits position 6 (T)
    // BROUGHT: B(0) R(1) O(2) U(3) G(4) H(5) T(6)
    // BXXXXXX → pos 0 match
    // XXXXXXT → pos 6 match
    const { knownPositions } = computeRevealData(['BXXXXXX', 'XXXXXXT'], SECRET);
    expect(knownPositions[0]).toBe('B');
    expect(knownPositions[6]).toBe('T');
  });

  it('returns empty arrays and all-null positions for empty input', () => {
    const { presentLetters, eliminatedLetters, knownPositions } = computeRevealData([], SECRET);
    expect(presentLetters).toEqual([]);
    expect(eliminatedLetters).toEqual([]);
    expect(knownPositions).toHaveLength(GAME_CONFIG.wordLength);
    expect(knownPositions.every(p => p === null)).toBe(true);
  });

  it('is case insensitive for both guesses and secret', () => {
    const lower = computeRevealData(['brought'], 'brought');
    const upper = computeRevealData(['BROUGHT'], 'BROUGHT');
    expect(lower.presentLetters).toEqual(upper.presentLetters);
    expect(lower.knownPositions).toEqual(upper.knownPositions);
  });

  it('returns presentLetters and eliminatedLetters sorted', () => {
    const { presentLetters, eliminatedLetters } = computeRevealData(['ZYXWBRO'], SECRET);
    expect(presentLetters).toEqual([...presentLetters].sort());
    expect(eliminatedLetters).toEqual([...eliminatedLetters].sort());
  });

  it('does not include the same letter in both present and eliminated', () => {
    const { presentLetters, eliminatedLetters } = computeRevealData(['BROWSER'], SECRET);
    const overlap = presentLetters.filter(l => eliminatedLetters.includes(l));
    expect(overlap).toEqual([]);
  });
});

// ─── derivePlayerKnowledge ────────────────────────────────────────────────────

describe('derivePlayerKnowledge', () => {
  const SECRET = 'BROUGHT'; // B R O U G H T

  const baseReveal = {
    presentLetters: ['B'],
    eliminatedLetters: ['A'],
    knownPositions: [null, null, null, null, null, null, null] as (string | null)[],
  };

  it('returns the reveal data unchanged when no final guesses are given', () => {
    const k = derivePlayerKnowledge(SECRET, baseReveal, []);
    expect(k.presentLetters).toEqual(['B']);
    expect(k.eliminatedLetters).toEqual(['A']);
    expect(k.knownPositions.every(p => p === null)).toBe(true);
  });

  it('fills known positions from exact-match final guesses', () => {
    // BROUGHT: pos 0 = B, pos 6 = T
    const k = derivePlayerKnowledge(SECRET, baseReveal, ['BXXXXXT']);
    expect(k.knownPositions[0]).toBe('B');
    expect(k.knownPositions[6]).toBe('T');
  });

  it('adds a letter to present when it appears in the secret', () => {
    const k = derivePlayerKnowledge(SECRET, { ...baseReveal, presentLetters: [] }, ['RXXXXXX']);
    expect(k.presentLetters).toContain('R');
  });

  it('adds a letter to eliminated when it is not in the secret', () => {
    const k = derivePlayerKnowledge(SECRET, { ...baseReveal, eliminatedLetters: [] }, ['ZXXXXXX']);
    expect(k.eliminatedLetters).toContain('Z');
  });

  it('moves a letter from eliminated to present if a later guess finds it in the secret', () => {
    // Start: E is eliminated (from revealData)
    const reveal = { ...baseReveal, eliminatedLetters: ['E'], presentLetters: [] };
    // Contribution guess got E wrong, but the secret is... wait, E is not in BROUGHT.
    // So let's use a different secret. Let's test with GRABBED: G R A B B E D
    // Actually let me use a case where eliminated → present makes sense.
    // CLAIMED: C L A I M E D — wait, that's only 7 letters: C(0) L(1) A(2) I(3) M(4) E(5) D(6)
    // Start: reveal says E is eliminated (wrong from contributions)
    // Then a final guess correctly places E → it should move to present
    // But wait: if E IS in the secret (CLAIMED has E), then secret.includes(ch) would be true
    // and eliminatedSet would have E deleted and presentSet would have E added.
    // This tests the "override" path.
    const secret = 'CLAIMED';
    const revealWithWrongE = {
      presentLetters: [],
      eliminatedLetters: ['E'],
      knownPositions: Array(7).fill(null) as (string | null)[],
    };
    const k = derivePlayerKnowledge(secret, revealWithWrongE, ['XXXXEXE']); // E appears in guess
    // E is in CLAIMED at position 5, so secret.includes('E') = true
    expect(k.presentLetters).toContain('E');
    expect(k.eliminatedLetters).not.toContain('E');
  });

  it('does not add a letter to eliminated if it is already known present', () => {
    // B is in BROUGHT and is in presentLetters from reveal
    // A final guess with B where B is at a wrong position — B is still in secret, so goes to present (not eliminated)
    const reveal = { ...baseReveal, presentLetters: ['B'] };
    const k = derivePlayerKnowledge(SECRET, reveal, ['XBXXXXX']);
    // B is in secret so it stays present, not eliminated
    expect(k.presentLetters).toContain('B');
    expect(k.eliminatedLetters).not.toContain('B');
  });

  it('is case insensitive for both answer and guesses', () => {
    const k1 = derivePlayerKnowledge('BROUGHT', baseReveal, ['brought']);
    const k2 = derivePlayerKnowledge('brought', baseReveal, ['BROUGHT']);
    expect(k1.knownPositions).toEqual(k2.knownPositions);
  });

  it('returns presentLetters and eliminatedLetters sorted', () => {
    const k = derivePlayerKnowledge(SECRET, baseReveal, ['ROUXGXX']);
    expect(k.presentLetters).toEqual([...k.presentLetters].sort());
    expect(k.eliminatedLetters).toEqual([...k.eliminatedLetters].sort());
  });

  it('accumulates knowledge across multiple final guesses', () => {
    // BROUGHT: B(0) R(1) O(2) U(3) G(4) H(5) T(6)
    const reveal = { presentLetters: [], eliminatedLetters: [], knownPositions: Array(7).fill(null) as (string | null)[] };
    const k = derivePlayerKnowledge(SECRET, reveal, [
      'BXXXXXX', // fills pos 0 = B
      'XXXXXXT', // fills pos 6 = T
    ]);
    expect(k.knownPositions[0]).toBe('B');
    expect(k.knownPositions[6]).toBe('T');
  });
});

// ─── computeBestContributor ───────────────────────────────────────────────────

describe('computeBestContributor', () => {
  const members = [makeMember('u1'), makeMember('u2')];
  const SECRET = 'BROUGHT'; // B R O U G H T

  it('returns the member whose guess shares the most letters with the answer', () => {
    const guesses = [
      makeGuess({ id: 'g1', user_id: 'u1', phase: 'contribution', guess: 'BROTHER' }), // B R O T H = 5 shared
      makeGuess({ id: 'g2', user_id: 'u2', phase: 'contribution', guess: 'AAAAAAA' }), // 0 shared
    ];
    const result = computeBestContributor(guesses, SECRET, members);
    expect(result?.userId).toBe('u1');
  });

  it('returns null when no contribution guess shares any letters', () => {
    const guesses = [
      makeGuess({ user_id: 'u1', phase: 'contribution', guess: 'AAAAAAA' }),
    ];
    expect(computeBestContributor(guesses, SECRET, members)).toBeNull();
  });

  it('returns null for an empty guess list', () => {
    expect(computeBestContributor([], SECRET, members)).toBeNull();
  });

  it('breaks ties in favour of the first guess in the array', () => {
    const guesses = [
      makeGuess({ id: 'g1', user_id: 'u1', phase: 'contribution', guess: 'BXXXXXX' }), // 1 shared (B)
      makeGuess({ id: 'g2', user_id: 'u2', phase: 'contribution', guess: 'RXXXXXX' }), // 1 shared (R)
    ];
    const result = computeBestContributor(guesses, SECRET, members);
    expect(result?.userId).toBe('u1'); // first in array wins tie
  });

  it('includes the display name in the result', () => {
    const guesses = [makeGuess({ user_id: 'u1', phase: 'contribution', guess: 'BROUGHT' })];
    const result = computeBestContributor(guesses, SECRET, members);
    expect(result?.displayName).toBe('Player u1');
  });

  it('returns null if the best-scoring guess belongs to a non-member user', () => {
    const guesses = [
      makeGuess({ user_id: 'unknown-user', phase: 'contribution', guess: 'BROUGHT' }),
    ];
    // The member lookup fails → best stays null
    expect(computeBestContributor(guesses, SECRET, members)).toBeNull();
  });
});

// ─── formatDuration ───────────────────────────────────────────────────────────

describe('formatDuration', () => {
  const base = '2026-03-03T10:00:00.000Z';

  function iso(offsetSeconds: number) {
    return new Date(new Date(base).getTime() + offsetSeconds * 1000).toISOString();
  }

  it('formats sub-60-second durations as "Xs"', () => {
    expect(formatDuration(base, iso(30))).toBe('30s');
  });

  it('formats exactly 60 seconds as "1m 0s"', () => {
    expect(formatDuration(base, iso(60))).toBe('1m 0s');
  });

  it('formats durations over 60 seconds as "Xm Ys"', () => {
    expect(formatDuration(base, iso(90))).toBe('1m 30s');
  });

  it('formats multi-minute durations correctly', () => {
    expect(formatDuration(base, iso(125))).toBe('2m 5s');
  });

  it('returns "0s" for a zero-duration interval', () => {
    expect(formatDuration(base, base)).toBe('0s');
  });

  it('returns "0s" when end is before start (negative diff)', () => {
    expect(formatDuration(iso(10), base)).toBe('0s');
  });
});

// ─── computeNewStreak ─────────────────────────────────────────────────────────

describe('computeNewStreak', () => {
  it('increments streak when there is a winner and all participated', () => {
    expect(computeNewStreak({ currentStreak: 3, winnerPlayerId: 'u1', allParticipated: true })).toBe(4);
  });

  it('increments from 0 on first solve with all participating', () => {
    expect(computeNewStreak({ currentStreak: 0, winnerPlayerId: 'u1', allParticipated: true })).toBe(1);
  });

  it('resets streak to 0 when nobody solved', () => {
    expect(computeNewStreak({ currentStreak: 5, winnerPlayerId: null, allParticipated: true })).toBe(0);
    expect(computeNewStreak({ currentStreak: 5, winnerPlayerId: null, allParticipated: false })).toBe(0);
  });

  it('preserves streak (no change) when there is a winner but not all participated', () => {
    expect(computeNewStreak({ currentStreak: 4, winnerPlayerId: 'u1', allParticipated: false })).toBe(4);
  });

  it('preserves a streak of 0 unchanged when winner exists but not all participated', () => {
    expect(computeNewStreak({ currentStreak: 0, winnerPlayerId: 'u1', allParticipated: false })).toBe(0);
  });
});
