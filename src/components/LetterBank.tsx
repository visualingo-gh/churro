// Displays all 26 letters with one of three states:
//   neutral     — letter is unclassified (outlined)
//   present     — letter exists in the secret word (solid fill)
//   eliminated  — letter is not in the secret word (struck-through, dim)
// States are derived from reveal data only — never from guess position matching.

type Props = {
  presentLetters: string[];
  eliminatedLetters: string[];
};

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export function LetterBank({ presentLetters, eliminatedLetters }: Props) {
  const present = new Set(presentLetters.map(l => l.toUpperCase()));
  const eliminated = new Set(eliminatedLetters.map(l => l.toUpperCase()));

  return (
    <div className="flex flex-wrap gap-1">
      {ALPHABET.map(letter => {
        const isPresent = present.has(letter);
        const isEliminated = eliminated.has(letter);

        let cls =
          'inline-flex items-center justify-center w-7 h-7 text-xs font-mono font-semibold border select-none ';

        if (isPresent) {
          cls += 'bg-gray-900 text-white border-gray-900';
        } else if (isEliminated) {
          cls += 'line-through opacity-25 border-gray-200 text-gray-400';
        } else {
          cls += 'border-gray-400 text-gray-700 bg-white';
        }

        return (
          <span key={letter} className={cls}>
            {letter}
          </span>
        );
      })}
    </div>
  );
}
