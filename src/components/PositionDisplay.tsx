// Renders the 7-letter word as a series of slots.
// — revealedIndex: the guaranteed position hint from Phase 2 (shown in blue).
// — knownPositions: per-player accumulated knowledge; filled slots shown in dark.
// — No per-position Wordle-style comparison is performed.

type Props = {
  knownPositions: (string | null)[];
  revealedIndex: number | null;
};

export function PositionDisplay({ knownPositions, revealedIndex }: Props) {
  return (
    <div className="flex gap-2">
      {Array.from({ length: 7 }, (_, i) => {
        const letter = knownPositions[i] ?? '';
        const isRevealHint = letter === '' && i === revealedIndex;
        const isFilled = letter !== '';

        return (
          <div key={i} className="flex flex-col items-center gap-0.5">
            <span
              className={`w-8 h-8 flex items-end justify-center pb-0.5 font-mono font-bold text-base ${
                isRevealHint
                  ? 'text-blue-600'
                  : isFilled
                  ? 'text-gray-900'
                  : 'text-transparent'
              }`}
            >
              {letter || '_'}
            </span>
            <div
              className={`w-8 h-0.5 ${isFilled ? 'bg-gray-800' : 'bg-gray-300'}`}
            />
            <span className="text-xs text-gray-400">{i + 1}</span>
          </div>
        );
      })}
    </div>
  );
}
