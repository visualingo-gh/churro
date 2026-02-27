// SERVER-ONLY — imports Node.js `fs`, will fail if bundled into client code.
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { GAME_CONFIG } from './game-config';

const { wordLength } = GAME_CONFIG;

function loadWordFile(subdir: string): Set<string> {
  const filePath = join(process.cwd(), 'data', subdir, `${wordLength}.txt`);
  if (!existsSync(filePath)) return new Set();
  return new Set(
    readFileSync(filePath, 'utf-8')
      .split('\n')
      .map(w => w.trim().toUpperCase())
      .filter(w => w.length === wordLength && /^[A-Z]+$/.test(w)),
  );
}

// ── Answer list (curated secret words) ────────────────────────────────────────

let _answers: Set<string> | null = null;

export function loadAnswers(): Set<string> {
  if (_answers) return _answers;
  _answers = loadWordFile('answers');
  if (_answers.size === 0) throw new Error(`[dictionary] answers/${wordLength}.txt not found or empty`);
  return _answers;
}

export function getAnswerList(): string[] {
  return [...loadAnswers()];
}

// ── Allowed list (valid guesses) ───────────────────────────────────────────────

let _allowed: Set<string> | null = null;

export function isValidWord(word: string): boolean {
  if (!_allowed) {
    _allowed = loadWordFile('allowed');
    if (_allowed.size === 0) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[dictionary] allowed/${wordLength}.txt not found — falling back to answers`);
      }
      _allowed = loadAnswers();
    } else if (process.env.NODE_ENV !== 'production') {
      console.log(`[dictionary] answers/${wordLength}.txt: ${loadAnswers().size} | allowed/${wordLength}.txt: ${_allowed.size}`);
    }
  }
  return _allowed.has(word.trim().toUpperCase());
}
