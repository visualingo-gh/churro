// SERVER-ONLY — imports Node.js `fs`, will fail if bundled into client code.
// Do not import this file from any client component or page.
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

function loadWordFile(filename: string): Set<string> {
  const filePath = join(process.cwd(), 'data', filename);
  const content = readFileSync(filePath, 'utf-8');
  return new Set(
    content
      .split('\n')
      .map(w => w.trim().toUpperCase())
      .filter(w => w.length === 7 && /^[A-Z]+$/.test(w)),
  );
}

// ── Answer list (curated secret words) ────────────────────────────────────────

let _answers: Set<string> | null = null;

export function loadAnswers(): Set<string> {
  if (_answers) return _answers;
  _answers = loadWordFile('answers7.txt');
  return _answers;
}

export function getAnswerList(): string[] {
  return [...loadAnswers()];
}

// ── Allowed list (valid guesses) ───────────────────────────────────────────────

let _allowed: Set<string> | null = null;

export function loadAllowed(): Set<string> {
  if (_allowed) return _allowed;

  const allowedPath = join(process.cwd(), 'data', 'allowed7.txt');
  if (existsSync(allowedPath)) {
    _allowed = loadWordFile('allowed7.txt');
    // Dev-only: report list sizes on first load
    if (process.env.NODE_ENV !== 'production') {
      console.log(
        `[dictionary] answers7.txt: ${loadAnswers().size} words | allowed7.txt: ${_allowed.size} words`,
      );
    }
  } else {
    console.warn(
      '[dictionary] WARNING: allowed7.txt not found — falling back to answers7.txt for guess validation.',
    );
    _allowed = loadAnswers();
  }

  return _allowed;
}

export function isValidWord(word: string): boolean {
  return loadAllowed().has(word.trim().toUpperCase());
}
