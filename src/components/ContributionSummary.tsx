// Structured read-out of the Phase 2 reveal.
// Pure data display — no interaction, no state.

import type { RevealData } from '@/types/game';

type Props = { revealData: RevealData };

export function ContributionSummary({ revealData }: Props) {
  const { presentLetters, eliminatedLetters, revealedPosition } = revealData;

  return (
    <dl className="text-sm space-y-2 font-mono">
      <div>
        <dt className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">
          Letters in word
        </dt>
        <dd className="font-semibold tracking-widest">
          {presentLetters.length > 0 ? presentLetters.join(' ') : <span className="text-gray-400 font-normal">none found</span>}
        </dd>
      </div>

      <div>
        <dt className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">
          Eliminated
        </dt>
        <dd className="text-gray-400 tracking-widest line-through decoration-gray-400">
          {eliminatedLetters.length > 0 ? eliminatedLetters.join(' ') : '—'}
        </dd>
      </div>

      <div>
        <dt className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">
          Guaranteed position
        </dt>
        <dd>
          Position{' '}
          <span className="font-bold">{revealedPosition.index + 1}</span>
          {' '}={' '}
          <span className="text-blue-600 font-bold">{revealedPosition.letter}</span>
        </dd>
      </div>
    </dl>
  );
}
