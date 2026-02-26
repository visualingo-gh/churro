# Project Rules – Async Multiplayer Daily Word Game

## Core Philosophy

- This is NOT a Wordle clone.
- Do not implement a 6-row grid or green/yellow tile UI.
- Focus on async multiplayer architecture, not animations or polish.
- Prefer simple, deterministic logic over clever abstractions.

---

## Architecture Rules

- All game state transitions must be server-side validated.
- The client must never control phase progression.
- All phase changes must be idempotent.
- Deterministic daily seed required (date-based).
- No real-time sockets unless explicitly requested.

---

## Code Standards

- Use TypeScript strictly (no `any`).
- Keep game logic in `/lib/game-engine.ts`.
- Keep database access in `/lib/db.ts`.
- API routes must be thin wrappers around engine functions.
- No business logic inside React components.

---

## Database Constraints

- Enforce one contribution guess per player per round.
- Enforce two final guesses max.
- Enforce phase correctness before accepting guesses.
- Prevent duplicate submissions.
- Never trust client-provided timestamps.

---

## UI Rules (V1)

- Minimal UI only.
- No animations.
- No heavy styling.
- Prioritize clarity over visual polish.
- Show game state clearly: phase, players locked, streak count.

---

## Scope Control

DO NOT:
- Add authentication yet.
- Add leaderboards.
- Add chat.
- Add global matchmaking.
- Add mobile optimization.
- Add AI-generated words.
- Add fancy reveal animations.

If a feature is not explicitly requested, do not implement it.
