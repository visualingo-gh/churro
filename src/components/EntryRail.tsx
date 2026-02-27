'use client';

// Slot-based word entry rail.
// knownPositions: pre-filled locked slots (user cannot edit these).
// onValueChange: called with current value string + whether all free slots are filled.
// onSubmit: called when Enter is pressed and value is complete.
//
// Mobile keyboard strategy:
//   A real <input> is the focus target (positioned absolute, opacity-0).
//   Tapping the rail focuses it → iOS/Android virtual keyboard appears.
//   onKeyDown handles special keys (Backspace, Enter, Arrows).
//   onChange handles character input on both mobile and desktop.

import { useEffect, useRef, useState } from 'react';
import { GAME_CONFIG } from '@/lib/game-config';

type Props = {
  knownPositions: (string | null)[];
  onValueChange: (value: string, isComplete: boolean) => void;
  onSubmit: () => void;
  disabled?: boolean;
};

function firstFreeIndex(known: (string | null)[]): number {
  const i = known.findIndex(p => p === null);
  return i === -1 ? GAME_CONFIG.wordLength : i;
}

export function EntryRail({ knownPositions, onValueChange, onSubmit, disabled }: Props) {
  const [typed, setTyped] = useState<string[]>(() => Array(GAME_CONFIG.wordLength).fill(''));
  const [cursor, setCursor] = useState<number>(() => firstFreeIndex(knownPositions));
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const knownKey = knownPositions.join(',');
  useEffect(() => {
    const blank = Array(GAME_CONFIG.wordLength).fill('');
    setTyped(blank);
    setCursor(firstFreeIndex(knownPositions));
    if (inputRef.current) inputRef.current.value = '';
    onValueChange(buildValue(knownPositions, blank), false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knownKey]);

  function buildValue(known: (string | null)[], t: string[]): string {
    return Array.from({ length: GAME_CONFIG.wordLength }, (_, i) => known[i] ?? t[i] ?? '').join('');
  }

  function nextFreeFrom(pos: number): number {
    for (let i = pos; i < GAME_CONFIG.wordLength; i++) {
      if (knownPositions[i] === null) return i;
    }
    return GAME_CONFIG.wordLength;
  }

  function prevFreeBefore(pos: number): number {
    for (let i = pos - 1; i >= 0; i--) {
      if (knownPositions[i] === null) return i;
    }
    return pos;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;

    if (e.key === 'Enter') {
      const value = buildValue(knownPositions, typed);
      if (value.split('').every(ch => ch !== '')) {
        e.preventDefault();
        onSubmit();
      }
      return;
    }

    if (e.key === 'Backspace') {
      e.preventDefault();
      if (inputRef.current) inputRef.current.value = '';
      let target = cursor;
      if (!typed[target]) target = prevFreeBefore(cursor);
      if (knownPositions[target] !== null) return;
      const next = [...typed];
      next[target] = '';
      setTyped(next);
      setCursor(target);
      const value = buildValue(knownPositions, next);
      onValueChange(value, false);
      return;
    }

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setCursor(prevFreeBefore(cursor));
      return;
    }

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const nxt = nextFreeFrom(cursor + 1);
      if (nxt < GAME_CONFIG.wordLength) setCursor(nxt);
      return;
    }

    // Letter keys: don't preventDefault — let them reach onChange
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (disabled) return;
    const raw = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
    // Keep input empty so it acts as a single-char buffer
    e.target.value = '';
    if (!raw) return;

    let newTyped = [...typed];
    let newCursor = cursor;

    for (const ch of raw.split('')) {
      const pos = nextFreeFrom(newCursor);
      if (pos >= GAME_CONFIG.wordLength) break;
      newTyped[pos] = ch;
      newCursor = nextFreeFrom(pos + 1);
      if (newCursor >= GAME_CONFIG.wordLength) newCursor = pos;
    }

    setTyped(newTyped);
    setCursor(newCursor);
    const value = buildValue(knownPositions, newTyped);
    const allFilled = value.split('').every(ch => ch !== '');
    onValueChange(value, allFilled);
  }

  function focusInput() {
    if (!disabled) inputRef.current?.focus();
  }

  function handleSlotClick(i: number) {
    if (disabled) return;
    if (knownPositions[i] === null) setCursor(i);
    inputRef.current?.focus();
  }

  return (
    <div
      className="relative inline-flex gap-3"
      onClick={focusInput}
      role="group"
      aria-label="Word entry"
    >
      {/* Real input — visually hidden but focusable, triggers mobile keyboard */}
      <input
        ref={inputRef}
        type="text"
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className="absolute inset-0 opacity-0 cursor-default caret-transparent"
        tabIndex={disabled ? -1 : 0}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={handleKeyDown}
        onChange={handleChange}
        aria-label="Word entry"
      />

      {/* Visual slots — gap-3 for breathing room */}
      {Array.from({ length: GAME_CONFIG.wordLength }, (_, i) => {
        const locked = knownPositions[i] !== null;
        const letter = knownPositions[i] ?? typed[i] ?? '';
        const isActive = !locked && focused && i === cursor && !disabled;

        return (
          <div
            key={i}
            onClick={(e) => { e.stopPropagation(); handleSlotClick(i); }}
            className="flex flex-col items-center gap-0.5"
          >
            <span
              className={`w-9 h-9 flex items-end justify-center pb-0.5 font-mono text-base ${
                locked
                  ? 'font-extrabold text-stone-800'   // locked: heavier weight, warm dark
                  : letter
                  ? 'font-bold text-stone-700'         // typed: bold but slightly lighter
                  : 'font-bold text-transparent'
              }`}
            >
              {letter || '_'}
            </span>
            <div
              className={`w-9 h-0.5 rounded-full ${
                isActive
                  ? 'bg-blue-500'
                  : locked
                  ? 'bg-stone-700'   // locked: dark warm underline
                  : letter
                  ? 'bg-stone-500'   // typed: medium underline
                  : 'bg-gray-400'    // empty: visible but not heavy
              }`}
            />
            <span className="text-xs text-gray-400">{i + 1}</span>
          </div>
        );
      })}
    </div>
  );
}
