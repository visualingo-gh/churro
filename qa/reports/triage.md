# QA-TRIAGE Report

**Date:** 2026-03-03
**Sources:** `spec-audit.md` · `ux-audit.md` · `edge-audit.md`
**Method:** Cross-report deduplication → ordered patch plan by impact and dependency

---

## Executive Summary

| Tier | Issues | Status |
|------|--------|--------|
| P0 — Ship Blockers | 7 (deduplicated to 5 patches) | Must fix before release |
| P1 — Next Improvements | 14 (deduplicated to 9 patches) | Fix before next milestone |
| P2 — Polish | 14 (deduplicated to 12 patches) | Backlog |

**Already resolved in this session:**
- Ready-button hang (root cause: P0-1 enum missing) — patched in `ready/route.ts` + `db.ts`
- Re-enter ready-state loss — patched in `ready/route.ts` + `db.ts`
- `supabase/patch-add-missing-columns.sql` — written (must still be applied to DB)

---

## P0 — Ship Blockers

Ordered by dependency: each patch unblocks those below it.

---

### PATCH-01 · Apply database patch (blocks everything)

**References:** SPEC P0-1, SPEC P0-2, EDGE-4

Run on the live Supabase instance:

```sql
-- supabase/patch-add-missing-columns.sql (already written)
ALTER TYPE game_phase ADD VALUE IF NOT EXISTS 'expired';
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE room_members ADD COLUMN IF NOT EXISTS last_action_at TIMESTAMPTZ;
```

Without this:
- `expireRoom` silently fails → rooms never expire (SPEC P0-1, P1-3)
- `softDeleteRoom` silently fails → delete button returns 500 (SPEC P0-2)
- `touchMemberActivity` silently fails → presence always blank (SPEC P0-2)
- `advanceToNextRound` throws `invalid input value for enum game_phase: "expired"` → ready button hangs for all players (SPEC P0-1, confirmed root cause)

**File:** `supabase/patch-add-missing-columns.sql`
**Action:** Apply to DB — no code change needed.

---

### PATCH-02 · Decide and align `finalGuesses` value

**References:** SPEC P0-3

`GAME_CONFIG.finalGuesses` is `4`. CLAUDE.md says "two final guesses max." These contradict each other. One must change.

| Option | Change |
|--------|--------|
| Keep 4 guesses | Update CLAUDE.md to say "four final guesses max" |
| Enforce 2 guesses | `src/lib/game-config.ts:3` → `finalGuesses: 2` |

**File:** `src/lib/game-config.ts:3`
**Action:** Product decision required — align config and spec before shipping.

---

### PATCH-03 · Add membership check to reveal route

**References:** SPEC P0-4, EDGE-2

The reveal route advances `reveal → final` for any caller with any UUID. A non-member can force the game into final phase before any legitimate player has seen the reveal data.

```typescript
// src/app/api/rooms/[id]/reveal/route.ts — after getRoomById, before setRevealViewedAt
if (userId) {
  const members = await getMembersByRoom(id);
  if (!members.find(m => m.user_id === userId)) {
    return NextResponse.json({ error: 'Not a member of this room' }, { status: 403 });
  }
  await setRevealViewedAt(userId, id);
  if (room.phase === 'reveal') {
    await advanceRoomPhase(id, 'reveal', 'final');
  }
}
```

**File:** `src/app/api/rooms/[id]/reveal/route.ts:33–40`
**Impact:** Closes EDGE-2 (non-member phase advance) and mitigates SPEC P0-4 (client-triggered phase change is still a design concern but becomes harmless from outside the room).

---

### PATCH-04 · Add `deleted_at` guards to guess, reveal, and join routes

**References:** EDGE-3, EDGE-5

After `getRoomById(id)` in each route, add:

```typescript
if (room.deleted_at) {
  return NextResponse.json({ error: 'Room not found' }, { status: 404 });
}
```

| File | Line after which to add |
|------|------------------------|
| `src/app/api/rooms/[id]/guess/route.ts` | After `if (!room) return 404` |
| `src/app/api/rooms/[id]/reveal/route.ts` | After `if (!room) return 404` |
| `src/app/api/rooms/[id]/join/route.ts` | After `if (!room) return 404` |

**Impact:** Prevents guesses, reveals, and new members being added to soft-deleted vaults. Requires PATCH-01 (needs `deleted_at` column to exist).

---

### PATCH-05 · Reduce final-guess TOCTOU window

**References:** EDGE-1, SPEC P1-4

The final guess count is enforced only at the application layer with no DB constraint. Concurrent requests can bypass the limit.

**Immediate mitigation** (application-level, does not fully close the race but narrows the window):

In `src/app/api/rooms/[id]/guess/route.ts`, re-fetch guesses immediately before inserting in the final phase and abort if count has changed since the first check.

**Full fix** (closes the race): Move the count check and insert into a Supabase RPC function so they execute atomically within a single transaction. Alternatively, add a DB-level constraint (e.g., a `CHECK` enforced by trigger).

**File:** `src/app/api/rooms/[id]/guess/route.ts:107–165`
**Note:** Requires a DB-level guard to fully close; application-level recheck is sufficient to ship.

---

## P1 — Next Improvements

Ordered by ease of fix, then by impact.

---

### PATCH-06 · Fix two invalid Tailwind classes

**References:** UX-6, UX-9

Two classes are silently ignored by the browser:

| Issue | File | Fix |
|-------|------|-----|
| `not-mono` → `font-sans` | `src/app/room/[id]/page.tsx:487` | Replace `not-mono` with `font-sans` |
| `opacity-35` → `opacity-40` | `src/components/LetterBank.tsx:31` | Replace `opacity-35` with `opacity-40` |

Without `font-sans`, the "contribution" label in guess history renders in monospace. Without a valid opacity, eliminated letters in the letter bank show at full opacity, indistinguishable from neutral letters.

---

### PATCH-07 · Align error colors: contribution → amber

**References:** UX-12

Contribution phase errors use `text-red-500`; final phase errors use `text-amber-700`. Red signals "blocked/broken." Amber signals "soft failure, try again." Both are recoverable errors — amber is correct for a game.

**File:** `src/app/room/[id]/page.tsx:453`

```tsx
// Before
{submitError && <p className="text-red-500 text-xs mt-2">{submitError}</p>}
// After
{submitError && <p className="text-amber-700 text-xs mt-2">{submitError}</p>}
```

---

### PATCH-08 · Add error checking to `advanceRoomPhase` and `expireRoom`

**References:** SPEC P1-2, SPEC P1-3

Both functions silently discard Supabase errors. Phase transitions fail invisibly.

```typescript
// db.ts — advanceRoomPhase
const { error } = await supabase.from('rooms').update(...)...;
if (error) throw new Error(`advanceRoomPhase failed: ${error.message}`);

// db.ts — expireRoom
const { error } = await supabase.from('rooms').update(...)...;
if (error) throw new Error(`expireRoom failed: ${error.message}`);
```

**File:** `src/lib/db.ts:57–67` (advanceRoomPhase), `src/lib/db.ts:98–105` (expireRoom)

---

### PATCH-09 · Detect 0-rows-updated in `advanceToNextRound`

**References:** SPEC P1-8

Supabase returns `error: null` when a `WHERE` clause matches 0 rows. `advanceToNextRound` checks `roomError` but not whether the update actually changed a row. The ready route then returns `{ advanced: true }` even though the room is still in `complete` phase.

```typescript
const { data, error: roomError } = await supabase
  .from('rooms')
  .update({ phase: 'contribution', game_date: newGameDate })
  .in('phase', ['complete', 'expired'])
  .eq('id', roomId)
  .select();
if (roomError) throw new Error(roomError.message);
if (!data || data.length === 0) throw new Error('Room was not in an advanceable phase');
```

**File:** `src/lib/db.ts:156–173`

---

### PATCH-10 · Expired-phase ready button: add "waiting for others" state

**References:** SPEC P1-5

The `complete` phase ready section correctly shows "You're ready. Waiting for others…" after clicking. The `expired` phase section does not — players get no feedback after clicking in a multi-player expired vault.

Mirror the `complete`-phase pattern:

```tsx
// page.tsx — expired phase ready block
{hasClickedReady || member.ready_for_next ? (
  <p className="text-sm text-stone-500">You're ready. Waiting for others…</p>
) : (
  <button onClick={startNextRound} disabled={readying}>
    {readying ? '…' : 'Start New Round'}
  </button>
)}
```

**File:** `src/app/room/[id]/page.tsx:683–692`

---

### PATCH-11 · Dashboard: add "your turn" signal to vault cards

**References:** UX-1

Vault cards show phase-level status but no per-player signal. A returning player cannot tell which vaults need their action.

Extend `getStatusLine` (or add a `myTurn` flag) in `src/app/page.tsx`. The data is already present in `RoomEntry` — derive from guess/member state:

| Phase | User has acted | User needs to act |
|-------|---------------|-------------------|
| contribution | "Submitted · Waiting" | "Add Your Word" |
| final | "Guesses used · Waiting" | "Crack the Vault" |
| reveal, complete, expired | — | — |

**File:** `src/app/page.tsx:19–38` (getStatusLine) and card rendering at `219–221`

---

### PATCH-12 · Entry rail: highlight active slot with background

**References:** UX-4

The active slot is indicated only by a blue underline (2 px × 36 px colour change). Add a background to the active slot wrapper:

```tsx
// EntryRail.tsx — slot wrapper className
isActive ? 'bg-blue-50 rounded' : ''
```

**File:** `src/components/EntryRail.tsx:191–199`

---

### PATCH-13 · Move complete-phase calculations to game engine exports

**References:** SPEC P1-1

Three game calculations are reimplemented inline in JSX in `page.tsx` despite having exports in `game-engine.ts`:

| Inline code | Engine function |
|-------------|----------------|
| `page.tsx:589–599` best-contributor | `computeBestContributor` |
| `page.tsx:585–588` fastest-solver | `computeRoundResult` |
| `page.tsx:611–618` duration format | `formatDuration` |

Replace inline versions with calls to the engine exports.

**Files:** `src/app/room/[id]/page.tsx:580–641`, `src/lib/game-engine.ts:85–182`

---

## P2 — Polish

Lower-impact or lower-effort items. No ordering dependency; any can be done independently.

---

| ID | References | Change | File |
|----|-----------|--------|------|
| P2-A | UX-2 | Remove `hover:-translate-y-px` from vault cards (violates "no animations") | `src/app/page.tsx:213–214` |
| P2-B | UX-3 | Fix `'Vault expired'` → `'Vault Expired'` (inconsistent capitalisation) | `src/app/page.tsx:29` |
| P2-C | UX-5 | Add `{filledCount} / 7` counter below entry rail | `src/components/EntryRail.tsx` |
| P2-D | UX-7 | Replace `·` incorrect-guess marker with `✗` or `×` for clarity | `src/app/room/[id]/page.tsx:494–497` |
| P2-E | UX-8 | Bump contribution label from `text-gray-300` to `text-gray-400` | `src/app/room/[id]/page.tsx:487` |
| P2-F | UX-10 | Update letter bank legend: "Filled = letter is in the word" | `src/components/LetterBank.tsx:43–45` |
| P2-G | UX-11 | Swap delete modal button order: `[Cancel] [Delete]` | `src/app/room/[id]/page.tsx:303–318` |
| P2-H | UX-13 | Client-side translation map for known API error strings | `src/app/room/[id]/page.tsx` — error display paths |
| P2-I | UX-14 | Replace "Processing contributions…" with "Hang tight — the vault is about to open." | `src/app/room/[id]/page.tsx:471` |
| P2-J | EDGE-7 | Block room creation if user already has an active `contribution`-phase room | `src/app/api/rooms/route.ts` |
| P2-K | EDGE-10 | Retry `generateInviteCode()` up to 3× on unique constraint violation | `src/app/api/rooms/route.ts:25–41` |
| P2-L | SPEC P2-4 | Guard `advanceToNextRound` against daily-mode `game_date` | `src/lib/db.ts:157` |

**Not recommended for current scope:**
- EDGE-6 (inactive member blocks streak): game-design decision, no code change suggested
- EDGE-8 (any member can delete): requires adding `created_by` column to `rooms` — schema change, low priority given invite-only access model
- SPEC P2-1 (mobile keyboard): pragmatic; EntryRail mobile input is working and removing it would break mobile
- SPEC P2-2/P2-3 (presentational helpers in component): minor violation, defer to a refactor pass

---

## Cross-Report Deduplication Map

| Canonical ID | Cross-references | Description |
|-------------|-----------------|-------------|
| PATCH-01 | SPEC P0-1, P0-2, P1-3, EDGE-4 | DB patch: enum + missing columns |
| PATCH-03 | SPEC P0-4, EDGE-2 | Membership check on reveal phase advance |
| PATCH-04 | EDGE-3, EDGE-5 | `deleted_at` guards across routes |
| PATCH-05 | EDGE-1, SPEC P1-4 | Final-guess count enforcement |
| PATCH-06 | UX-6, UX-9 | Invalid Tailwind classes |
| PATCH-08 | SPEC P1-2, P1-3 | Error swallowing in phase transitions |

---

*Generated by QA-TRIAGE agent · Churro repo · 2026-03-03*
