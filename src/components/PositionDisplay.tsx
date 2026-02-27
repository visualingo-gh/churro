// Renders the word as a series of slots.
// knownPositions: per-player accumulated knowledge; filled slots shown in dark.
// No per-position Wordle-style comparison is performed.

import { GAME_CONFIG } from '@/lib/game-config';

type Props = {
  knownPositions: (string | null)[];
};

export function PositionDisplay({ knownPositions }: Props) {
  return (
    <div className="flex gap-2">
      {Array.from({ length: GAME_CONFIG.wordLength }, (_, i) => {
        const letter = knownPositions[i] ?? '';
        const isFilled = letter !== '';

        return (
          <div key={i} className="flex flex-col items-center gap-0.5">
            <span
              className={`w-8 h-8 flex items-end justify-center pb-0.5 font-mono font-bold text-base ${
                isFilled ? 'text-gray-900' : 'text-transparent'
              }`}
            >
              {letter || '_'}
            </span>
            <div
              className={`w-8 h-0.5 ${isFilled ? 'bg-gray-800' : 'bg-gray-400'}`}
            />
          </div>
        );
      })}
    </div>
  );
}
