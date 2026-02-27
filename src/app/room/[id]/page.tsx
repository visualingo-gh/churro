'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { Guess, PlayerKnowledge, Result, RevealData, Room, RoomMember } from '@/types/game';
import { LetterBank } from '@/components/LetterBank';
import { PositionDisplay } from '@/components/PositionDisplay';
import { EntryRail } from '@/components/EntryRail';
import { GAME_CONFIG } from '@/lib/game-config';
import { getAppMode } from '@/lib/app-mode';
import { relativeTime } from '@/lib/relative-time';

const APP_MODE = getAppMode();

type RoomState = {
  room: Room;
  members: RoomMember[];
  guesses: Guess[];
  result: Result | null;
  answer: string | null;
  knowledge: PlayerKnowledge | null;
};

function getRoomLabel(members: RoomMember[], userId: string): string {
  if (!members.length) return 'Vault';
  const others = members.filter(m => m.user_id !== userId).map(m => m.display_name);
  return others.length === 0 ? 'Solo Vault' : `You · ${others.join(' · ')}`;
}

function getRoundLabel(gameDate: string): string {
  const n = parseInt(gameDate, 10);
  return isNaN(n) ? gameDate : `Round ${n}`;
}

export default function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [revealData, setRevealData] = useState<RevealData | null>(null);
  const [playerKnowledge, setPlayerKnowledge] = useState<PlayerKnowledge | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  const [railValue, setRailValue] = useState('');
  const [inputIsValid, setInputIsValid] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);

  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const [readying, setReadying] = useState(false);

  const [beginConfirm, setBeginConfirm] = useState(false);
  const [beginning, setBeginning] = useState(false);

  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const revealFetchedForDate = useRef<string | null>(null);

  const fetchReveal = useCallback(async (uid: string | null, room: Room) => {
    const { phase, game_date } = room;
    if (!['reveal', 'final', 'complete', 'expired'].includes(phase)) return;
    if (revealFetchedForDate.current === game_date) return;

    revealFetchedForDate.current = game_date;

    const url = `/api/rooms/${id}/reveal${uid ? `?userId=${uid}` : ''}`;
    const res = await fetch(url);
    if (res.ok) {
      const json = await res.json();
      setRevealData(json.revealData);
    } else {
      revealFetchedForDate.current = null;
    }
  }, [id]);

  const fetchRoomState = useCallback(async () => {
    try {
      const uid = localStorage.getItem('churro_user_id');
      const url = `/api/rooms/${id}${uid ? `?userId=${uid}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) { setPageError('Vault not found'); return; }

      const data: RoomState = await res.json();
      setRoomState(data);
      setPageError(null);

      if (data.knowledge) setPlayerKnowledge(data.knowledge);

      if (revealFetchedForDate.current && revealFetchedForDate.current !== data.room.game_date) {
        revealFetchedForDate.current = null;
        setRevealData(null);
        setPlayerKnowledge(null);
      }

      await fetchReveal(uid, data.room);
    } catch {
      setPageError('Failed to load vault');
    } finally {
      setLoading(false);
    }
  }, [id, fetchReveal]);

  useEffect(() => {
    const stored = localStorage.getItem('churro_user_id');
    setUserId(stored);
  }, []);

  useEffect(() => {
    fetchRoomState();
    pollRef.current = setInterval(fetchRoomState, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchRoomState]);

  async function joinRoom() {
    const uid = localStorage.getItem('churro_user_id');
    if (!uid) { router.push('/'); return; }
    setJoining(true);
    setJoinError(null);
    try {
      const res = await fetch(`/api/rooms/${id}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: uid }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchRoomState();
    } catch (e) {
      setJoinError((e as Error).message);
    } finally {
      setJoining(false);
    }
  }

  async function beginGame() {
    if (!userId || beginning) return;
    setBeginning(true);
    try {
      const res = await fetch(`/api/rooms/${id}/begin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setBeginConfirm(false);
      await fetchRoomState();
    } catch { } finally {
      setBeginning(false);
    }
  }

  async function deleteRoom() {
    if (!userId || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/rooms/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      router.push('/');
    } catch { } finally {
      setDeleting(false);
      setDeleteConfirm(false);
    }
  }

  async function startNextRound() {
    if (!userId || readying) return;
    setReadying(true);
    try {
      await fetch(`/api/rooms/${id}/ready`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      await fetchRoomState();
    } catch { } finally {
      setReadying(false);
    }
  }

  async function submitGuess() {
    if (!railValue || !userId || submitting || !inputIsValid) return;
    setSubmitting(true);
    setSubmitError(null);
    setLastCorrect(null);
    try {
      const res = await fetch(`/api/rooms/${id}/guess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, guess: railValue }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (typeof data.correct === 'boolean') setLastCorrect(data.correct);
      if (data.knowledge) setPlayerKnowledge(data.knowledge);
      setRailValue('');
      setInputIsValid(false);
      await fetchRoomState();
    } catch (e) {
      setSubmitError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="p-8 text-sm text-gray-500">Loading…</div>;
  if (pageError) return <div className="p-8 text-sm text-red-500">{pageError}</div>;
  if (!roomState) return null;

  const { room, members, guesses, result, answer } = roomState;

  // Deleted vault — friendly interstitial
  if (room.deleted_at) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-lg font-medium text-stone-800">This vault has been deleted.</p>
        <button
          onClick={() => router.push('/')}
          className="px-5 py-2 bg-stone-900 text-white text-sm rounded font-medium"
        >
          Back to Dashboard
        </button>
      </main>
    );
  }

  const isInRoom = members.some(m => m.user_id === userId);
  const canJoin = !room.is_locked && members.length < room.max_players && room.phase === 'contribution';

  const myContribution = guesses.find(g => g.user_id === userId && g.phase === 'contribution');
  const myFinalGuesses = guesses.filter(g => g.user_id === userId && g.phase === 'final');
  const contributionCount = guesses.filter(g => g.phase === 'contribution').length;
  const remainingFinal = GAME_CONFIG.finalGuesses - myFinalGuesses.length;
  const correctFinalGuess = myFinalGuesses.find(g => g.is_correct === true) ?? null;

  const knownPositions: (string | null)[] = playerKnowledge?.knownPositions
    ?? revealData?.knownPositions
    ?? Array(GAME_CONFIG.wordLength).fill(null);
  const presentLetters = playerKnowledge?.presentLetters ?? revealData?.presentLetters ?? [];
  const eliminatedLetters = playerKnowledge?.eliminatedLetters ?? revealData?.eliminatedLetters ?? [];

  const phaseLabel = !room.is_locked ? 'Lobby'
    : room.phase === 'contribution' ? 'Add Your Word'
    : room.phase === 'reveal' ? 'Reveal'
    : room.phase === 'final' ? 'Crack the Vault'
    : room.phase === 'expired' ? 'Expired'
    : 'Complete';

  return (
    <main className="min-h-screen p-8 max-w-md mx-auto font-sans">

      {/* Begin game confirmation modal */}
      {beginConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 max-w-sm w-full rounded-lg shadow-lg">
            <p className="font-medium mb-1">
              Start vault with {members.length} player{members.length !== 1 ? 's' : ''}?
            </p>
            <p className="text-sm text-gray-500 mb-5">
              Roster will be locked. No new players can join.
            </p>
            <div className="flex gap-3">
              <button
                onClick={beginGame}
                disabled={beginning}
                className="px-5 py-2 bg-stone-900 text-white text-sm font-medium rounded disabled:opacity-50"
              >
                {beginning ? '…' : 'Begin'}
              </button>
              <button
                onClick={() => setBeginConfirm(false)}
                className="px-5 py-2 border border-gray-300 text-sm rounded"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 max-w-sm w-full rounded-lg shadow-lg">
            <p className="font-medium mb-1">Delete this vault?</p>
            <p className="text-sm text-gray-500 mb-5">This cannot be undone.</p>
            <div className="flex gap-3">
              <button
                onClick={deleteRoom}
                disabled={deleting}
                className="px-5 py-2 bg-red-600 text-white text-sm font-medium rounded disabled:opacity-50"
              >
                {deleting ? '…' : 'Delete'}
              </button>
              <button
                onClick={() => setDeleteConfirm(false)}
                className="px-5 py-2 border border-gray-300 text-sm rounded"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-start mb-8">
        <div>
          <button
            onClick={() => router.push('/')}
            className="text-xs text-gray-400 mb-1 hover:text-gray-600"
          >
            ← Dashboard
          </button>
          <h1 className="text-xl font-bold text-stone-900">{getRoomLabel(members, userId ?? '')}</h1>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="text-right text-xs text-gray-500 space-y-0.5">
            <p className="font-medium text-stone-700">{phaseLabel}</p>
            <p>Streak: <strong>{room.streak_count}</strong></p>
            {APP_MODE === 'round'
              ? <p>{getRoundLabel(room.game_date)}</p>
              : <p>{room.game_date}</p>
            }
          </div>
          {isInRoom && (
            <button
              onClick={() => setDeleteConfirm(true)}
              className="text-xs text-gray-300 hover:text-red-400 mt-1"
            >
              Delete vault
            </button>
          )}
        </div>
      </div>

      {/* Members */}
      <div className="mb-6">
        <p className="text-xs font-medium text-gray-400 mb-1 uppercase tracking-wide">
          Players ({members.length})
        </p>
        <div className="flex flex-col gap-1.5">
          {members.map(m => (
            <div key={m.user_id}>
              <p className="text-sm text-stone-800">
                {m.display_name}{m.user_id === userId ? ' (you)' : ''}
              </p>
              <p className="text-xs text-gray-400">{relativeTime(m.last_action_at)}</p>
            </div>
          ))}
          {!room.is_locked && room.phase === 'contribution' && members.length < 4 && (
            <p className="text-sm text-gray-400">Waiting for others to join…</p>
          )}
        </div>
      </div>

      {/* Not a member */}
      {!isInRoom && !userId && (
        <div className="mb-6 border border-gray-200 rounded-lg p-4">
          <p className="text-sm text-gray-600 mb-2">Set a display name before joining.</p>
          <button
            onClick={() => router.push('/')}
            className="px-4 py-2 bg-stone-900 text-white text-sm rounded"
          >
            Go to Dashboard
          </button>
        </div>
      )}

      {!isInRoom && userId && canJoin && (
        <div className="mb-6 border border-gray-200 rounded-lg p-4">
          <p className="text-sm font-medium mb-3">Join this vault</p>
          <button
            onClick={joinRoom}
            disabled={joining}
            className="px-4 py-2 bg-stone-900 text-white text-sm rounded disabled:opacity-50"
          >
            {joining ? '…' : 'Join'}
          </button>
          {joinError && <p className="text-red-500 text-xs mt-2">{joinError}</p>}
        </div>
      )}

      {!isInRoom && userId && !canJoin && (
        <p className="text-sm text-gray-400 mb-6">This vault is no longer accepting players.</p>
      )}

      {/* Game UI */}
      {isInRoom && (
        <>
          {/* ── CONTRIBUTION ── */}
          {room.phase === 'contribution' && (
            <div className="mb-6">
              {!room.is_locked ? (
                <div className="space-y-4">
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Lobby</p>
                  <p className="text-sm text-gray-500">
                    Share the invite link below. Begin when everyone is here.
                  </p>
                  <button
                    onClick={() => setBeginConfirm(true)}
                    className="px-5 py-2 bg-stone-900 text-white text-sm font-medium rounded"
                  >
                    Begin Game
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-xs font-medium text-gray-400 mb-1 uppercase tracking-wide">
                    Add Your Word
                  </p>
                  <p className="text-sm text-gray-500 mb-4">
                    {contributionCount} of {members.length} locked in
                  </p>

                  {myContribution ? (
                    <p className="text-sm text-emerald-700">Your word is locked in. Waiting for others…</p>
                  ) : (
                    <>
                      <p className="text-xs text-gray-400 mb-4">
                        Submit one {GAME_CONFIG.wordLength}-letter word. No feedback until everyone submits.
                      </p>
                      <div className="mb-4">
                        <EntryRail
                          key={`contribution-${room.game_date}`}
                          knownPositions={Array(GAME_CONFIG.wordLength).fill(null)}
                          onValueChange={(val, complete) => {
                            setRailValue(val);
                            setInputIsValid(complete);
                          }}
                          onSubmit={submitGuess}
                          disabled={submitting}
                        />
                      </div>
                      <button
                        onClick={submitGuess}
                        disabled={submitting || !inputIsValid}
                        className="px-4 py-2 bg-stone-900 text-white text-sm rounded disabled:opacity-50"
                      >
                        {submitting ? '…' : 'Lock In'}
                      </button>
                      {submitError && <p className="text-red-500 text-xs mt-2">{submitError}</p>}
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── REVEAL (transitional) ── */}
          {room.phase === 'reveal' && (
            <div className="mb-6">
              <p className="text-xs font-medium text-gray-400 mb-1 uppercase tracking-wide">Reveal</p>
              <p className="text-sm text-gray-400">Processing contributions…</p>
            </div>
          )}

          {/* ── FINAL ── */}
          {room.phase === 'final' && revealData && (
            <div className="mb-6 space-y-6">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                Crack the Vault
              </p>

              <div>
                <p className="text-xs text-gray-400 mb-2 uppercase tracking-wide">Letter bank</p>
                <LetterBank presentLetters={presentLetters} eliminatedLetters={eliminatedLetters} />
              </div>

              {myFinalGuesses.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-gray-400 uppercase tracking-wide">Your guesses</p>
                  {myFinalGuesses.map(g => (
                    <p key={g.id} className="font-mono text-sm">
                      {g.guess}{' '}
                      <span className={g.is_correct ? 'text-emerald-600' : 'text-red-400'}>
                        {g.is_correct ? '✓' : '✗'}
                      </span>
                    </p>
                  ))}
                </div>
              )}

              {/* ONE input rail — PositionDisplay only shown when no rail is active */}
              {correctFinalGuess ? (
                <>
                  <PositionDisplay knownPositions={knownPositions} />
                  <p className="text-sm text-emerald-700">You cracked it. Waiting for others…</p>
                </>
              ) : remainingFinal > 0 ? (
                <>
                  {lastCorrect === false && (
                    <p className="text-sm text-red-500">Not quite. Try again.</p>
                  )}
                  <p className="text-xs text-gray-400">
                    {remainingFinal} guess{remainingFinal !== 1 ? 'es' : ''} remaining
                  </p>
                  <div>
                    <EntryRail
                      key={`final-${room.game_date}-${myFinalGuesses.length}`}
                      knownPositions={knownPositions}
                      onValueChange={(val, complete) => {
                        setRailValue(val);
                        setInputIsValid(complete);
                      }}
                      onSubmit={submitGuess}
                      disabled={submitting}
                    />
                  </div>
                  <button
                    onClick={submitGuess}
                    disabled={submitting || !inputIsValid}
                    className="px-4 py-2 bg-stone-900 text-white text-sm rounded disabled:opacity-50"
                  >
                    {submitting ? '…' : 'Submit'}
                  </button>
                  {submitError && <p className="text-red-500 text-xs mt-1">{submitError}</p>}
                </>
              ) : (
                <>
                  <PositionDisplay knownPositions={knownPositions} />
                  <p className="text-sm text-gray-500">No guesses remaining. Waiting for others…</p>
                </>
              )}
            </div>
          )}

          {/* ── COMPLETE ── */}
          {room.phase === 'complete' && (
            <div className="mb-6 space-y-6">

              <div className="border border-gray-200 rounded-lg p-4 space-y-2">
                {result?.winner_user_id ? (
                  <>
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Vault Opened</p>
                    <p className="font-mono text-2xl tracking-widest font-bold text-stone-900">
                      {answer ?? '???????'}
                    </p>
                    <p className="text-sm text-emerald-700">
                      {result.winner_user_id === userId
                        ? 'You cracked it!'
                        : `${members.find(m => m.user_id === result.winner_user_id)?.display_name ?? 'Someone'} cracked it.`}
                    </p>
                    {result.all_participated && (
                      <p className="text-xs text-gray-400">
                        All participated — streak: {room.streak_count}
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Vault Locked</p>
                    <p className="font-mono text-2xl tracking-widest font-bold text-gray-400">
                      {answer ?? '???????'}
                    </p>
                    <p className="text-sm text-red-500">Nobody cracked it. Streak reset.</p>
                  </>
                )}
              </div>

              {(() => {
                const allFinal = guesses.filter(g => g.phase === 'final');
                const allContrib = guesses.filter(g => g.phase === 'contribution');

                const solverGuess = allFinal
                  .filter(g => g.is_correct)
                  .sort((a, b) => new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime())[0];

                let bestContribMember: RoomMember | null = null;
                if (answer) {
                  const secret = new Set(answer.toUpperCase().split(''));
                  let bestScore = 0;
                  for (const g of allContrib) {
                    const score = g.guess.toUpperCase().split('').filter(ch => secret.has(ch)).length;
                    if (score > bestScore) {
                      bestScore = score;
                      bestContribMember = members.find(m => m.user_id === g.user_id) ?? null;
                    }
                  }
                }

                if (!solverGuess && !bestContribMember) return null;

                return (
                  <div className="space-y-2">
                    {solverGuess && (() => {
                      const solver = members.find(m => m.user_id === solverGuess.user_id);
                      const revealStart = members
                        .map(m => m.reveal_viewed_at)
                        .filter((t): t is string => t !== null)
                        .sort()[0];
                      const duration = revealStart && result?.solved_at
                        ? (() => {
                            const ms = new Date(result.solved_at).getTime() - new Date(revealStart).getTime();
                            const s = Math.max(0, Math.floor(ms / 1000));
                            const m = Math.floor(s / 60);
                            return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
                          })()
                        : null;
                      return (
                        <div key="solver" className="flex items-baseline gap-2 text-sm">
                          <span>👑</span>
                          <span>
                            <span className="font-medium">Fastest Solver</span>
                            {' — '}{solver?.display_name ?? 'Unknown'}
                            {duration && <span className="text-gray-400 text-xs ml-1">({duration})</span>}
                          </span>
                        </div>
                      );
                    })()}
                    {bestContribMember && (
                      <div className="flex items-baseline gap-2 text-sm">
                        <span>🔓</span>
                        <span>
                          <span className="font-medium">Best Contribution</span>
                          {' — '}{bestContribMember.display_name}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="text-xs text-gray-400 space-y-0.5">
                <p>{guesses.filter(g => g.phase === 'contribution').length} of {members.length} contributed</p>
                <p>{new Set(guesses.filter(g => g.phase === 'final').map(g => g.user_id)).size} of {members.length} attempted final solve</p>
              </div>

              {APP_MODE === 'round' ? (
                <div className="border border-gray-200 rounded-lg p-4">
                  <p className="text-xs text-gray-500 mb-3">
                    {members.filter(m => m.ready_for_next).length} of {members.length} ready for next word
                  </p>
                  {members.find(m => m.user_id === userId)?.ready_for_next ? (
                    <p className="text-sm text-gray-500">You&apos;re ready. Waiting for others…</p>
                  ) : (
                    <button
                      onClick={startNextRound}
                      disabled={readying}
                      className="px-5 py-2 bg-stone-900 text-white text-sm font-medium rounded disabled:opacity-50"
                    >
                      {readying ? '…' : 'Next Word'}
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-400">New word tomorrow.</p>
              )}
            </div>
          )}

          {/* ── EXPIRED ── */}
          {room.phase === 'expired' && (
            <div className="mb-6 space-y-4">
              <div className="border border-gray-200 rounded-lg p-4 space-y-2">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Vault Expired</p>
                <p className="text-sm text-gray-500">This vault went quiet and expired due to inactivity.</p>
                <p className="font-mono text-2xl tracking-widest font-bold text-gray-300">
                  {answer ?? '???????'}
                </p>
                <p className="text-xs text-gray-400">No streak change.</p>
              </div>
              {APP_MODE === 'round' && (
                <button
                  onClick={startNextRound}
                  disabled={readying}
                  className="px-5 py-2 bg-stone-900 text-white text-sm font-medium rounded disabled:opacity-50"
                >
                  {readying ? '…' : 'Start New Round'}
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* Invite link — lobby only */}
      {room.phase === 'contribution' && !room.is_locked && (
        <div className="mt-8 p-3 bg-stone-50 rounded-lg text-xs text-gray-500">
          <p className="font-medium mb-1">Invite link:</p>
          <p className="font-mono break-all select-all">
            {typeof window !== 'undefined' ? window.location.href : ''}
          </p>
        </div>
      )}
    </main>
  );
}
