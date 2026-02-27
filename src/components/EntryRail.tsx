'use client';

// Slot-based word entry rail.
// knownPositions: pre-filled locked slots (user cannot edit these).
// onValueChange: called with current value string + whether all free slots are filled.
// onSubmit: called when Enter is pressed and value is complete.

import { useEffect, useRef, useState } from 'react';
import { GAME_CONFIG } from '@/lib/game-config';

type Props = {
  knownPositions: (string | null)[];
  onValueChange: (value: string, isComplete: boolean) => void;
  onSubmit: () => void;
  disabled?: boolean;
};

function firstFreeIndex(knownPositions: (string | null)[]): number {
  const i = knownPositions.findIndex(p => p === null);
  return i === -1 ? GAME_CONFIG.wordLength : i;
}

function lastFreeIndex(knownPositions: (string | null)[]): number {
  for (let i = GAME_CONFIG.wordLength - 1; i >= 0; i--) {
    if (knownPositions[i] === null) return i;
  }
  return -1;
}

export function EntryRail({ knownPositions, onValueChange, onSubmit, disabled }: Props) {
  const [typed, setTyped] = useState<string[]>(() => Array(GAME_CONFIG.wordLength).fill(''));
  const [cursor, setCursor] = useState<number>(() => firstFreeIndex(knownPositions));
  const railRef = useRef<HTMLDivElement>(null);

  // Reset typed state when knownPositions changes (e.g. after a guess locks new positions)
  const knownKey = knownPositions.join(',');
  useEffect(() => {
    const next = Array(GAME_CONFIG.wordLength).fill('');
    setTyped(next);
    setCursor(firstFreeIndex(knownPositions));
    // Notify parent of reset
    const value = buildValue(knownPositions, next);
    onValueChange(value, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knownKey]);

  function buildValue(known: (string | null)[], t: string[]): string {
    return Array.from({ length: GAME_CONFIG.wordLength }, (_, i) =>
      known[i] ?? t[i] ?? ''
    ).join('');
  }

  function nextFreeAfter(pos: number): number {
    for (let i = pos + 1; i < GAME_CONFIG.wordLength; i++) {
      if (knownPositions[i] === null) return i;
    }
    return pos; // stay at current if no free slot ahead
  }

  function prevFreeBefore(pos: number): number {
    for (let i = pos - 1; i >= 0; i--) {
      if (knownPositions[i] === null) return i;
    }
    return pos; // stay if no free slot behind
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;

    if (e.key === 'Enter') {
      const value = buildValue(knownPositions, typed);
      const allFilled = value.split('').every(ch => ch !== '');
      if (allFilled) {
        e.preventDefault();
        onSubmit();
      }
      return;
    }

    if (e.key === 'Backspace') {
      e.preventDefault();
      let target = cursor;
      // If current slot is already empty, move back first
      if (!typed[target]) {
        target = prevFreeBefore(cursor);
      }
      if (knownPositions[target] !== null) return;
      const next = [...typed];
      next[target] = '';
      setTyped(next);
      setCursor(target);
      const value = buildValue(knownPositions, next);
      const allFilled = value.split('').every(ch => ch !== '');
      onValueChange(value, allFilled);
      return;
    }

    if (/^[a-zA-Z]$/.test(e.key)) {
      e.preventDefault();
      if (knownPositions[cursor] !== null) return;
      const next = [...typed];
      next[cursor] = e.key.toUpperCase();
      setTyped(next);
      const value = buildValue(knownPositions, next);
      const newCursor = nextFreeAfter(cursor);
      setCursor(newCursor);
      const allFilled = value.split('').every(ch => ch !== '');
      onValueChange(value, allFilled);
      return;
    }

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setCursor(prevFreeBefore(cursor));
      return;
    }

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setCursor(nextFreeAfter(cursor));
      return;
    }
  }

  function handleSlotClick(i: number) {
    if (disabled) return;
    if (knownPositions[i] !== null) return;
    setCursor(i);
    railRef.current?.focus();
  }

  const value = buildValue(knownPositions, typed);
  const isLast = lastFreeIndex(knownPositions) === cursor;

  return (
    <div
      ref={railRef}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={handleKeyDown}
      className="flex gap-2 focus:outline-none"
      aria-label="Word entry"
    >
      {Array.from({ length: GAME_CONFIG.wordLength }, (_, i) => {
        const locked = knownPositions[i] !== null;
        const letter = knownPositions[i] ?? typed[i] ?? '';
        const isActive = !locked && i === cursor && !disabled;

        return (
          <div
            key={i}
            onClick={() => handleSlotClick(i)}
            className="flex flex-col items-center gap-0.5"
          >
            <span
              className={`w-8 h-8 flex items-end justify-center pb-0.5 font-mono font-bold text-base ${
                locked
                  ? 'text-gray-900'
                  : letter
                  ? 'text-gray-900'
                  : 'text-transparent'
              }`}
            >
              {letter || '_'}
            </span>
            <div
              className={`w-8 h-0.5 ${
                isActive
                  ? 'bg-blue-500'
                  : locked
                  ? 'bg-gray-800'
                  : letter
                  ? 'bg-gray-700'
                  : 'bg-gray-300'
              }`}
            />
            <span className="text-xs text-gray-400">{i + 1}</span>
          </div>
        );
      })}
      {/* invisible input for mobile keyboard on focus */}
      <input
        type="text"
        aria-hidden
        readOnly
        value={value}
        className="sr-only"
        tabIndex={-1}
      />
    </div>
  );
}
