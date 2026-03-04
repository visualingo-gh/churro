# QA-SPEC Audit Report

**Date:** 2026-03-03
**Audited against:** `CLAUDE.md`
**Scope:** Game rules · UI requirements · Lobby behavior · Expiration logic · Presence logic

---

## Summary

| Severity | Count |
|----------|-------|
| P0       | 4     |
| P1       | 8     |
| P2       | 4     |
| **Total**| **16**|

---

## P0 — Ship Blockers

### P0-1 · `'expired'` missing from `game_phase` PostgreSQL enum

**Rule:** All game state transitions must be server-side validated. Phase changes must be idempotent.

**Issue:**
`supabase/schema.sql` and `supabase/migration.sql` define `game_phase` as `('contribution', 'reveal', 'final', 'complete')`. The codebase uses `'expired'` as a sixth phase throughout. When `advanceToNextRound` runs this query:

```
WHERE game_date = $1 AND phase IN ('complete', 'expired')
```

PostgreSQL throws `invalid input value for enum game_phase: "expired"`. The rooms table update never executes, the route returns 500, and the client is left in a hung ready state. This is the confirmed root cause of the solo-vault ready-button hang.

**Reproduction:**
1. Create a solo vault, play through to `complete` phase.
2. Click "Next Word."
3. Observe: button disappears, "Waiting for others…" shown permanently (API returned 500).

**Suspected files:**
- `supabase/schema.sql:6` — enum definition
- `supabase/migration.sql:16` — enum definition
- `src/lib/db.ts:160–165` — `advanceToNextRound` WHERE clause
- `src/lib/db.ts:98–104` — `expireRoom` also sets `phase = 'expired'`, fails silently

**Fix:** Run `supabase/patch-add-missing-columns.sql` (already created). Adds `'expired'` via `ALTER TYPE game_phase ADD VALUE 'expired'`.

---

### P0-2 · Schema missing `expires_at`, `deleted_at`, `last_action_at` columns

**Rule:** All game state transitions must be server-side validated.

**Issue:**
Three columns referenced extensively in `src/lib/db.ts` are absent from both SQL files:

| Column | Table | Used in |
|--------|-------|---------|
| `expires_at` | `rooms` | `touchMemberActivity`, `touchRoomActivity`, `advanceToNextRound`, lazy-expiry check in GET handler |
| `deleted_at` | `rooms` | `softDeleteRoom`, GET handler deleted-room guard |
| `last_action_at` | `room_members` | `touchMemberActivity`, presence display in page.tsx |

Without `expires_at`, the lazy-expiry mechanism in `src/app/api/rooms/[id]/route.ts:43–51` and `guess/route.ts:56–63` is a no-op. Inactive vaults never expire. Without `deleted_at`, soft-delete returns a DB error. Without `last_action_at`, `touchMemberActivity` fails silently and presence timestamps are never shown.

**Reproduction:**
1. Fresh install with `schema.sql` as written.
2. Attempt to delete a vault → 500 from `softDeleteRoom`.
3. Let a vault go inactive past 48 h → still accessible, never expires.

**Suspected files:**
- `supabase/schema.sql:16–26` — rooms table definition
- `supabase/migration.sql:24–34` — rooms table definition
- `src/lib/db.ts:71–93` — `touchMemberActivity` / `touchRoomActivity`
- `src/lib/db.ts:108–114` — `softDeleteRoom`

**Fix:** `supabase/patch-add-missing-columns.sql` covers all three.

---

### P0-3 · `GAME_CONFIG.finalGuesses = 4` contradicts CLAUDE.md "two final guesses max"

**Rule:** "Enforce two final guesses max." (Database Constraints section)

**Issue:**
`src/lib/game-config.ts:3` sets `finalGuesses: 4`. The UI displays "4 guesses remaining" and allows 4 submissions. This directly contradicts the spec. One of these is wrong; the spec wins unless intentionally changed.

**Reproduction:**
1. Reach `final` phase in any vault.
2. Submit wrong guesses; observe counter goes 4 → 3 → 2 → 1 → 0.

**Suspected files:**
- `src/lib/game-config.ts:3`
- `src/app/room/[id]/page.tsx:250` — `remainingFinal` uses this value

---

### P0-4 · Client-initiated `reveal → final` phase transition

**Rule:** "The client must never control phase progression."

**Issue:**
`src/app/api/rooms/[id]/reveal/route.ts:38–40` advances the room from `'reveal'` to `'final'` inside a GET endpoint that any client can call at any time:

```typescript
if (room.phase === 'reveal') {
  await advanceRoomPhase(id, 'reveal', 'final');
}
```

The client page triggers this via `fetchReveal`, which fires on every poll when the phase is `'reveal'`. The first client to poll after the contribution phase ends forces the game into `'final'` for all players — before latecomers have acknowledged the reveal. Any client (including a malicious one) can advance the phase by hitting `/api/rooms/[id]/reveal?userId=...`.

`advanceRoomPhase` is idempotent (guarded by `fromPhase`), so double-firing is safe, but the **trigger** is client-driven, which violates the architecture rule.

**Reproduction:**
1. Two-player vault reaches `contribution` phase, both contribute.
2. Player A opens the reveal URL directly in a new tab (bypassing normal UI flow).
3. Room immediately advances to `final` — Player B may not have seen the reveal data yet.

**Suspected files:**
- `src/app/api/rooms/[id]/reveal/route.ts:33–40`
- `src/app/room/[id]/page.tsx:67–82` — `fetchReveal` callback triggers this on every poll

---

## P1 — Next Improvements

### P1-1 · Business logic duplicated in React component (best-contributor, solver, duration)

**Rule:** "Keep game logic in `/lib/game-engine.ts`. No business logic inside React components."

**Issue:**
`src/app/room/[id]/page.tsx` computes three pieces of game logic inline inside JSX render, all of which already have counterparts in `game-engine.ts` that go unused:

| Logic | Component location | Existing engine function |
|-------|--------------------|--------------------------|
| Best contributor by letter overlap | `page.tsx:589–599` | `computeBestContributor` (`game-engine.ts:154`) |
| Fastest solver detection | `page.tsx:585–588` | `computeRoundResult` (`game-engine.ts:85`) |
| Solve duration formatting | `page.tsx:611–618` | `formatDuration` (`game-engine.ts:176`) |

The component implements its own versions of these functions as inline IIFEs and closures, diverging from the engine implementations over time.

**Reproduction:** Open the `complete` phase UI — all three calculations are re-derived client-side from raw `guesses` and `members` data that the server already processed into `result`.

**Suspected files:**
- `src/app/room/[id]/page.tsx:580–641`
- `src/lib/game-engine.ts:85–112, 154–173, 176–182` — unused exports

---

### P1-2 · `advanceRoomPhase` swallows DB errors silently

**Rule:** "All game state transitions must be server-side validated."

**Issue:**
`src/lib/db.ts:57–67`:

```typescript
export async function advanceRoomPhase(...): Promise<void> {
  await supabase
    .from('rooms')
    .update({ phase: toPhase })
    .eq('id', roomId)
    .eq('phase', fromPhase);
  // no error check
}
```

If Supabase returns an error (RLS, network, constraint), the function returns successfully. Callers in `guess/route.ts` and `reveal/route.ts` cannot detect the failure. The phase silently fails to advance; players see the UI state stuck.

**Suspected files:**
- `src/lib/db.ts:57–67`
- `src/app/api/rooms/[id]/guess/route.ts:99, 129` — callers
- `src/app/api/rooms/[id]/reveal/route.ts:39` — caller

---

### P1-3 · `expireRoom` swallows DB errors silently

**Rule:** Same as P1-2.

**Issue:** `src/lib/db.ts:98–105` does not check the Supabase response. If the `'expired'` enum value is invalid (see P0-1), this silently fails every time. Rooms past their `expires_at` are never marked expired, so players continue to be able to interact with them past the expiry window.

**Suspected files:**
- `src/lib/db.ts:98–105`
- `src/app/api/rooms/[id]/route.ts:49` — caller in GET handler
- `src/app/api/rooms/[id]/guess/route.ts:61` — caller in guess submission

---

### P1-4 · No DB-level enforcement of final guess count

**Rule:** "Enforce two final guesses max." / "Prevent duplicate submissions."

**Issue:**
Final guess count is enforced only in application code (`canSubmitFinalGuess` in `game-engine.ts:67–69`). The `guesses` table has a unique constraint for contribution guesses (`one_contribution_per_user_per_game`, `schema.sql:52–54`) but nothing prevents a player from inserting more than `N` final guesses directly. Application-only enforcement is bypassable if the check in `guess/route.ts:111–113` is ever skipped or circumvented.

**Suspected files:**
- `supabase/schema.sql:40–54` — guesses table, missing final-guess constraint
- `src/lib/game-engine.ts:67–69` — sole enforcement point

---

### P1-5 · Expired phase ready button has no "waiting for others" guard

**Rule:** "Show game state clearly: phase, players locked, streak count." / Consistency.

**Issue:**
In `complete` phase, the ready section checks `hasClickedReady || member.ready_for_next` and switches to "You're ready. Waiting for others…" after clicking (`page.tsx:654–664`). The `expired` phase shows the same "Start New Round" button but never transitions to a waiting state (`page.tsx:683–692`). In a multi-player vault that expired, all players see an active button even after clicking — they have no feedback that their click registered.

**Reproduction:**
1. Allow a multi-player vault to expire (past `expires_at`).
2. Player A clicks "Start New Round."
3. Player A observes: button briefly disabled, then re-enabled. No "waiting" message shown.

**Suspected files:**
- `src/app/room/[id]/page.tsx:672–693` — expired phase UI block

---

### P1-6 · `setMemberReady` and `resetMemberReady` swallow DB errors

**Rule:** "All game state transitions must be server-side validated."

**Issue:**
Both `src/lib/db.ts:146–152` and `src/lib/db.ts:155–161` perform updates with no error checking. If `setMemberReady` fails silently, the fallback in `ready/route.ts:43` (counting `m.user_id === userId`) masks the failure for solo vaults but not multi-player. Players who clicked ready appear un-ready after page navigation.

**Suspected files:**
- `src/lib/db.ts:146–161`

---

### P1-7 · `touchMemberActivity` silently ignores errors on both sub-queries

**Issue:**
`src/lib/db.ts:74–84` uses `Promise.all` with two Supabase updates but discards both results. If `last_action_at` column is absent (P0-2), the member update fails silently every time. Presence timestamps in the UI are always stale/missing.

**Suspected files:**
- `src/lib/db.ts:71–84`

---

### P1-8 · `advanceToNextRound` does not verify rooms update succeeded

**Rule:** "All phase changes must be idempotent." (implied: verify the change occurred)

**Issue:**
`src/lib/db.ts:160–166` checks `roomError` (good), but Supabase returns `error: null` with 0 rows updated when the `WHERE` conditions don't match. The function returns without throwing, the ready route returns `{ advanced: true }`, and the client transitions to the post-advance UI — but the room is still in `complete` phase. All subsequent polls show the stale phase.

**Suspected files:**
- `src/lib/db.ts:156–173`
- `src/app/api/rooms/[id]/ready/route.ts:45–53`

---

## P2 — Polish

### P2-1 · `EntryRail` contains mobile-specific keyboard workarounds

**Rule:** "DO NOT: Add mobile optimization."

**Issue:**
`src/components/EntryRail.tsx` uses a hidden `<input>` element with `inputMode="text"`, `autoCapitalize="characters"`, and programmatic `focus()`/`blur()` to manage iOS/Safari virtual keyboard behaviour. This is specifically mobile-targeted implementation. The approach is pragmatic and functional, but it crosses the "no mobile optimization" scope boundary.

**Suspected files:**
- `src/components/EntryRail.tsx` — hidden input, focus management

---

### P2-2 · `canJoin` and room-label logic computed in React component

**Rule:** "No business logic inside React components."

**Issue:**
`src/app/room/[id]/page.tsx:244–245` computes join eligibility inline:

```typescript
const canJoin = !room.is_locked && members.length < room.max_players && room.phase === 'contribution';
```

`src/app/room/[id]/page.tsx:24–28` computes the room label. These are presentational helpers, but the join-eligibility predicate encodes game rules (phase check, lock check, capacity check) that belong in the engine layer.

**Suspected files:**
- `src/app/room/[id]/page.tsx:24–28, 244–245`

---

### P2-3 · Dashboard (`app/page.tsx`) derives phase label and ready-count inline

**Rule:** "No business logic inside React components."

**Issue:**
The dashboard card computes display state (phase label, member ready counts, staleness of last action) entirely inline in JSX. While these are display-only transforms, they duplicate logic that the server already knows and could include in the `getRoomsByUserId` response.

**Suspected files:**
- `src/app/page.tsx` — dashboard card rendering

---

### P2-4 · `advanceToNextRound` uses `parseInt` on a potentially non-numeric `game_date`

**Issue:**
`src/lib/db.ts:157`: `parseInt(currentGameDate, 10) + 1`. In daily mode, `game_date` is a `YYYY-MM-DD` string. `parseInt('2026-03-03') = 2026`. If someone switches `NEXT_PUBLIC_APP_MODE` between round and daily on an existing room, `game_date` becomes `'2027'` after the first advance, losing the date semantics entirely. There is no guard against calling `advanceToNextRound` on a daily-mode room.

**Suspected files:**
- `src/lib/db.ts:157`
- `src/app/api/rooms/[id]/ready/route.ts:47` — only called in `round` mode but the DB function has no mode guard

---

## Findings Not Flagged (Confirmed Compliant)

| Area | Status |
|------|--------|
| No `any` TypeScript usage | ✅ Compliant |
| No 6-row Wordle grid or green/yellow tile UI | ✅ Compliant |
| No real-time sockets | ✅ Compliant — 3-second polling only |
| No authentication system | ✅ Compliant — anonymous localStorage identity |
| No leaderboards, chat, or global matchmaking | ✅ Compliant |
| No AI-generated words | ✅ Compliant — curated wordlist via `answers7.txt` |
| No fancy reveal animations | ✅ Compliant |
| Server-side timestamps only | ✅ Compliant — all timestamps are `new Date()` server-side |
| Contribution uniqueness enforced at DB level | ✅ Compliant — partial unique index |
| Seed is deterministic per room+round | ✅ Compliant — `djb2Hash(roomId:gameKey)` |
| Phase check before accepting guesses | ✅ Compliant — `guess/route.ts` guards both phases |
| Duplicate submission prevented | ✅ Compliant — `alreadySubmitted` check + DB unique index |

---

*Generated by QA-SPEC agent · Churro repo · 2026-03-03*
