# QA-EDGE Audit Report

**Date:** 2026-03-03
**Audited against:** `CLAUDE.md` · Database Constraints · Architecture Rules
**Method:** Static analysis of all API route handlers and DB functions

---

## Summary

| Severity | Count | Description |
|----------|-------|-------------|
| P0 | 3 | Actively exploitable without special access |
| P1 | 4 | Requires specific conditions; realistic in production |
| P2 | 3 | Low-impact or requires attacker knowledge |

---

## P0 — Exploitable Now

### EDGE-1 · Final guess limit bypassable via concurrent requests (TOCTOU race)

**Route:** `POST /api/rooms/[id]/guess` — final phase
**File:** `src/app/api/rooms/[id]/guess/route.ts:107–113`

**How it works:**

The final guess count is enforced with a read-then-write pattern:

```typescript
const userFinalGuesses = guesses.filter(
  g => g.user_id === userId && g.phase === 'final'
);
if (!canSubmitFinalGuess(userFinalGuesses.length)) {
  return NextResponse.json({ error: 'No final guesses remaining' }, { status: 400 });
}
// ... insertGuess(...)
```

`canSubmitFinalGuess` returns `playerFinalGuessCount < GAME_CONFIG.finalGuesses`.

**Exploit steps:**

1. Player reaches final phase with N guesses remaining (e.g. 1).
2. Send two identical POST requests simultaneously to `/api/rooms/[id]/guess`.
3. Both requests read `userFinalGuesses` before either insert completes.
4. Both see `length = N-1`, both pass the check, both insert.
5. Player now has more guesses than the configured limit.

**Impact:** Player can submit arbitrarily many final guesses. With enough guesses, every 7-letter word in the answers list is eventually exhausted.

**Missing guard:**
There is no database-level unique constraint or check preventing more than `finalGuesses` rows for `(user_id, room_id, game_date, phase='final')`. The contribution phase has a DB-level partial unique index that prevents this exactly:

```sql
CREATE UNIQUE INDEX one_contribution_per_user_per_game
  ON guesses(user_id, room_id, game_date)
  WHERE phase = 'contribution';
```

No equivalent exists for `phase = 'final'`.

**Required guard:**

Add a database check constraint or a per-player partial unique index with a counter. The simplest DB-level defense is a trigger or a `CHECK` that limits final rows. Alternatively, wrap the read + insert in a Supabase transaction (RPC function) so the count check and insert are atomic.

At minimum, add application-level retry protection: re-query `getGuessesByRoom` immediately before inserting and abort if the count has changed:

```typescript
// Re-verify count inside the same handler, post-insert-lock
const freshGuesses = await getGuessesByRoom(id, gameDate);
const freshFinalCount = freshGuesses.filter(
  g => g.user_id === userId && g.phase === 'final'
).length;
if (freshFinalCount >= GAME_CONFIG.finalGuesses) {
  return NextResponse.json({ error: 'No final guesses remaining' }, { status: 400 });
}
```

This does not fully close the race (still TOCTOU), but reduces the window. Only a DB constraint closes it completely.

---

### EDGE-2 · Non-member can advance `reveal → final` phase for any room

**Route:** `GET /api/rooms/[id]/reveal?userId=<any-uuid>`
**File:** `src/app/api/rooms/[id]/reveal/route.ts:33–40`

**How it works:**

```typescript
if (userId) {
  await setRevealViewedAt(userId, id);   // no-op if not a member
  if (room.phase === 'reveal') {
    await advanceRoomPhase(id, 'reveal', 'final');  // runs regardless
  }
}
```

The route:
1. Accepts any UUID as `userId` via query string — no authentication, no membership check.
2. Calls `setRevealViewedAt` (safe: updates 0 rows if user is not a member).
3. **Unconditionally advances the phase** from `reveal` to `final`.

**Exploit steps:**

1. Obtain any room ID (included in all invite links).
2. Send: `GET /api/rooms/{roomId}/reveal?userId={any-valid-uuid}`
3. Room immediately advances to `final` — potentially before any legitimate player has seen the reveal data.
4. Players in the `final` phase have no letter bank, no position clues from reveal, and no solve timer start.

**Impact:** Attacker can force the `final` phase to start before any player has loaded the reveal. Legitimate players enter `final` phase cold (no knowledge state from reveal). This also breaks the solve timer (no `reveal_viewed_at` set for members, so duration calculation in complete phase is blank).

**Required guard:**

Add a membership check before advancing the phase:

```typescript
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

---

### EDGE-3 · Guesses and reveal can be submitted to a soft-deleted vault

**Routes:** `POST /api/rooms/[id]/guess`, `GET /api/rooms/[id]/reveal`
**Files:** `src/app/api/rooms/[id]/guess/route.ts`, `src/app/api/rooms/[id]/reveal/route.ts`

**How it works:**

The room `GET` handler checks `if (room.deleted_at)` and returns a minimal payload (client shows "deleted" interstitial). But the `guess` and `reveal` routes call `getRoomById` and proceed without checking `deleted_at`:

```typescript
// guess/route.ts — no deleted_at check
let room = await getRoomById(id);
if (!room) { return 404; }
// ← proceeds directly to expiry checks and phase logic
```

**Exploit steps:**

1. Player A deletes the vault (calls `DELETE /api/rooms/{id}`).
2. Player B (who still has the room ID and knows their `userId`) sends `POST /api/rooms/{id}/guess`.
3. Guess is accepted and inserted if the phase allows it.
4. `reveal` endpoint also runs normally and can advance the phase.

**Impact:** Deleted vaults continue to accept game actions. Data is written to a logically deleted room. If `deleted_at` is used as a soft boundary (room should be tombstoned), this violates the boundary.

**Required guard:**

In both routes, add after `getRoomById`:

```typescript
if (room.deleted_at) {
  return NextResponse.json({ error: 'Room not found' }, { status: 404 });
}
```

---

## P1 — Realistic in Production

### EDGE-4 · Expiry check silently disabled when `expires_at` column is absent

**Routes:** `GET /api/rooms/[id]`, `POST /api/rooms/[id]/guess`
**Files:** `src/app/api/rooms/[id]/route.ts:43–51`, `guess/route.ts:56–63`

**How it works:**

The lazy expiry check reads:

```typescript
if (
  room.expires_at &&
  room.phase !== 'complete' &&
  room.phase !== 'expired' &&
  new Date(room.expires_at) <= new Date()
) {
  await expireRoom(id);
  ...
}
```

If the `expires_at` column does not exist in the database (see SPEC audit P0-2), `room.expires_at` is `undefined`. `undefined && ...` short-circuits to `false`. The expiry block is never entered. Rooms that have been inactive for weeks continue to accept guesses indefinitely.

**Exploit steps:**

1. Fresh database installation using `schema.sql` (which lacks `expires_at`).
2. Create a room, begin a game, let the `expires_at` window pass.
3. Submit guesses. They are accepted because `room.expires_at` is undefined.

**Required guard:**

Run `supabase/patch-add-missing-columns.sql` to add `expires_at`. Also consider a server-side guard that treats `expires_at = null` as "never expires by time" explicitly (current behaviour) vs "treat as immediately expired" (stricter). Document the intent.

---

### EDGE-5 · Soft-deleted vault can be joined via direct API call

**Route:** `POST /api/rooms/[id]/join`
**File:** `src/app/api/rooms/[id]/join/route.ts`

**How it works:**

The join route checks `is_locked` and `members.length >= max_players` but does not check `deleted_at`:

```typescript
const room = await getRoomById(id);
if (!room) { return 404; }
if (room.is_locked) { return 409; }
const members = await getMembersByRoom(id);
if (members.length >= room.max_players) { return 409; }
// ← no deleted_at check
```

**Exploit steps:**

1. Vault is soft-deleted (phase is `contribution`, not locked).
2. New user sends `POST /api/rooms/{id}/join` with their `userId`.
3. They are added as a member of the deleted vault.
4. They can now submit contribution guesses to the deleted vault (intersects with EDGE-3).

**Required guard:**

```typescript
if (room.deleted_at) {
  return NextResponse.json({ error: 'Room not found' }, { status: 404 });
}
```

---

### EDGE-6 · `shouldAdvanceToComplete` can advance phase before all players have acted

**File:** `src/lib/game-engine.ts:72–83`, `src/app/api/rooms/[id]/guess/route.ts:128–153`

**How it works:**

```typescript
export function shouldAdvanceToComplete(params: {
  members: { user_id: string }[];
  finalGuesses: Guess[];
}): boolean {
  if (finalGuesses.some(g => g.is_correct === true)) return true;
  return members.every(
    m => finalGuesses.filter(g => g.user_id === m.user_id).length >= GAME_CONFIG.finalGuesses
  );
}
```

The first condition: `finalGuesses.some(g => g.is_correct === true)` advances immediately when **any** player solves. This is expected game design.

However, in the `computeRoundResult` path, only `finalGuesses` are checked for `all_participated`. A player who submitted a contribution guess but made zero final guesses is counted as a participant in `participatingIds` only if they appear in `contributionGuesses` OR `finalGuesses`. A player who joined but never submitted any guess at all (`!participatingIds.has(m.user_id)`) breaks the `allParticipated` flag, reducing the streak unnecessarily.

**Exploit / edge case steps:**

1. 3-player vault. Player A and B contribute; Player C never submits a contribution guess (phone dies mid-session).
2. Player A solves in final phase → phase advances to `complete`.
3. `allParticipated` is `false` (C never guessed).
4. Streak does not increment even though 2 of 3 players fully participated.

This is a game-design issue rather than a security exploit, but it creates a scenario where one inactive player permanently prevents streak growth.

**Note:** No code change suggested per QA-SPEC scope ("Do NOT suggest new features"). Documenting as an engine edge case for triage.

---

### EDGE-7 · Unlimited room creation per authenticated user

**Route:** `POST /api/rooms`
**File:** `src/app/api/rooms/route.ts`

**How it works:**

Any user with a valid `userId` can create unlimited rooms. There is no per-user room cap, no rate limiting, and no check for existing open rooms.

**Exploit steps:**

1. Obtain a valid `userId` (trivial: stored in localStorage, visible in any request).
2. Script repeated POST calls to `/api/rooms`.
3. Database fills with orphaned rooms. Invite code space (6 chars from 32-char alphabet) begins to exhaust.

**Required guard:**

At minimum, check that the user does not already have an active (non-deleted, non-expired) room in `contribution` phase before creating a new one. Full rate limiting is out of scope per CLAUDE.md.

---

## P2 — Low Impact / Requires Inside Knowledge

### EDGE-8 · Any room member can delete the vault

**Route:** `DELETE /api/rooms/[id]`
**File:** `src/app/api/rooms/[id]/route.ts:79–112`

The delete handler checks only that the requesting user is a room member — not that they are the room creator:

```typescript
const members = await getMembersByRoom(id);
if (!members.find(m => m.user_id === userId)) {
  return NextResponse.json({ error: 'Not a member of this room' }, { status: 403 });
}
await softDeleteRoom(id);
```

Any member (including a player who just joined) can delete the vault for all participants.

**Exploit steps:**

1. Player B joins Player A's vault.
2. Player B sends `DELETE /api/rooms/{id}` with their own `userId`.
3. Vault is soft-deleted. Player A loses the game.

There is no "room owner" concept in the schema. Fixing this requires either adding a `created_by` column to `rooms`, or recording the first member as the owner. Low priority since the UI has a confirmation modal and the invite link doesn't encourage adversarial sharing.

---

### EDGE-9 · Begin game callable before invitation period; no minimum member warning

**Route:** `POST /api/rooms/[id]/begin`
**File:** `src/app/api/rooms/[id]/begin/route.ts`

The begin route checks the requesting user is a member but not the minimum number of members. A player can begin a solo vault immediately after creating it:

```typescript
const members = await getMembersByRoom(id);
if (!members.find(m => m.user_id === userId)) { return 403; }
await lockRoom(id);
```

This is intentional (solo mode is supported), but the begin confirmation modal in the UI (`page.tsx:273–276`) does say "Start vault with N player(s)?" — so the user is informed. The server does not enforce a minimum, meaning the schema `max_players BETWEEN 2 AND 4` could be technically violated if the intent were "at least 2 players required."

No security risk, but the schema constraint and the actual behaviour are misaligned.

---

### EDGE-10 · Invite code collisions are undetected

**Route:** `POST /api/rooms`
**File:** `src/app/api/rooms/route.ts:6–9`

```typescript
function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
```

The 6-character invite code has `32^6 = ~1.07 billion` combinations. The `invite_code` column has a `UNIQUE` constraint in the schema. If `createRoom` is called with a colliding invite code, Supabase returns an error caught by the generic `catch {}` block:

```typescript
} catch {
  return NextResponse.json({ error: 'Failed to create room' }, { status: 500 });
}
```

The collision probability is negligible at low room counts but the error handling is silent. A collision returns a generic 500 with no retry.

**Required guard (low priority):** Retry `generateInviteCode()` up to 3 times on unique constraint violation, or use a UUID-based invite code.

---

## Confirmed Guards (Passing)

| Exploit | Guard location | Status |
|---------|----------------|--------|
| Contribution guess when phase ≠ contribution | `guess/route.ts:78–103` | ✅ Returns 400 |
| Final guess when phase ≠ final | `guess/route.ts:106–165` | ✅ Returns 400 |
| Guess before begin (unlocked room) | `guess/route.ts:79–81` | ✅ Returns 400 |
| Duplicate contribution guess (app-level) | `guess/route.ts:83–88` | ✅ Returns 409 |
| Duplicate contribution guess (DB-level) | `schema.sql:52–54` | ✅ Partial unique index |
| Join after roster lock | `join/route.ts:26–28` | ✅ Returns 409 |
| Join when room is full | `join/route.ts:32–34` | ✅ Returns 409 |
| Guess with non-existent room | `guess/route.ts:50–53` | ✅ Returns 404 |
| Ready in wrong phase | `ready/route.ts:26–28` | ✅ Returns 400 |
| Ready when not a member | `ready/route.ts:31–33` | ✅ Returns 403 |
| Begin game when already started | `begin/route.ts:21–27` | ✅ Returns 409 |
| Begin game when not a member | `begin/route.ts:29–31` | ✅ Returns 403 |
| Client-provided timestamps | All routes | ✅ Server uses `new Date()` only |
| Client controlling word selection | `getGameWord(roomId, gameDate)` | ✅ Deterministic server-side |

---

*Generated by QA-EDGE agent · Churro repo · 2026-03-03*
