# QA-UX Audit Report

**Date:** 2026-03-03
**Audited against:** `CLAUDE.md` · UI Rules (V1)
**Focus areas:** Dashboard cards · Entry rail · Guess history · Letter bank · Delete placement · Error tone

---

## Summary

| Area | Issues | Severity |
|------|--------|----------|
| Dashboard cards | 3 | P1, P2, P2 |
| Entry rail | 2 | P1, P2 |
| Guess history | 3 | P1, P2, P2 |
| Letter bank | 2 | P1, P2 |
| Delete vault placement | 1 | P2 |
| Error tone | 3 | P1, P2, P2 |

---

## Dashboard Cards

### UX-1 · No "your turn" vs "waiting" signal on vault cards `P1`

**File:** `src/app/page.tsx:219–221`

All vault cards display a phase-level status ("Add Your Word", "Crack the Vault") but give no per-player signal about whether the current user has already acted. A player returning to the dashboard cannot tell at a glance which vaults need their input vs which are waiting on others.

| Status shown | Situations it covers |
|---|---|
| "Add Your Word" | User hasn't submitted yet ← needs action |
| "Add Your Word" | User submitted, waiting ← no action needed |
| "Crack the Vault" | User has guesses left ← needs action |
| "Crack the Vault" | User exhausted guesses ← no action needed |

**Minimal fix:** `getStatusLine` (or the card rendering) can be extended to accept a `myTurn: boolean` flag derived from the room's existing guess/member data — then append `" · Your turn"` when action is needed. The data is already available in `RoomEntry`.

---

### UX-2 · Dashboard card hover has a CSS transition (animation) `P2`

**File:** `src/app/page.tsx:213–214`

```
hover:shadow-sm hover:-translate-y-px
```

`hover:-translate-y-px` applies a 1 px vertical translate on hover. Tailwind applies this via `transition` utilities automatically in many configurations. CLAUDE.md: "No animations."

**Minimal fix:** Remove `hover:-translate-y-px`. Keep `hover:shadow-sm hover:border-stone-300` for hover feedback without movement.

---

### UX-3 · "Vault expired" has inconsistent capitalisation `P2`

**File:** `src/app/page.tsx:29`

`getStatusLine` returns:
- `'Vault Opened'` — title case
- `'Vault Locked'` — title case
- `'Vault expired'` — sentence case (lowercase 'e')

Reads as a typo on the dashboard card.

**Minimal fix:** `case 'expired': return 'Vault Expired';`

---

## Entry Rail

### UX-4 · Active-slot indicator is underline-only; easily missed `P1`

**File:** `src/components/EntryRail.tsx:191–199`

The cursor position is communicated solely by switching the underline from `bg-gray-500` to `bg-blue-500` — a 2 px high, 36 px wide colour change. The letter area itself shows `_` in `text-transparent` (invisible). A user who glances at the rail without noticing the underline colour has no clear indication of where they will type next.

The blue is also the only blue element on any screen that otherwise uses stone/gray/amber tones, which is jarring on first encounter.

**Minimal fix:** In the `isActive` branch, add a subtle background or border to the slot box:

```tsx
// change the wrapper span's class to include:
isActive ? 'bg-blue-50 rounded' : ''
```

This adds a whisper-level background highlight to the active slot without adding weight.

---

### UX-5 · No filled-slot count display on rail `P2`

**File:** `src/components/EntryRail.tsx:141–205`

The rail shows individual slots but does not surface a "3 / 7" counter or any other completion indicator. Players with pre-filled locked slots (from the reveal) can miscalculate how many free slots they have left. The submit button is disabled until complete (`inputIsValid`), but there is no progressive feedback during typing.

**Minimal fix:** Add below the rail:

```tsx
<p className="text-xs text-gray-400 mt-1">
  {filledCount} / {GAME_CONFIG.wordLength}
</p>
```

where `filledCount = buildValue(knownPositions, typed).replace(/[^A-Z]/g, '').length`.

---

## Guess History

### UX-6 · `not-mono` is not a valid Tailwind class `P1`

**File:** `src/app/room/[id]/page.tsx:487`

```tsx
<span className="ml-2 not-mono text-gray-300">contribution</span>
```

`not-mono` is not defined in Tailwind CSS. The intent appears to be resetting `font-mono` back to sans-serif for the label, but this class is silently ignored by the browser. The "contribution" label inherits `font-mono` from the parent `<p>` element, rendering in monospace when it visually should not.

**Minimal fix:** Replace `not-mono` with `font-sans`:

```tsx
<span className="ml-2 font-sans text-gray-300">contribution</span>
```

---

### UX-7 · Incorrect guess marker `·` is too subtle `P2`

**File:** `src/app/room/[id]/page.tsx:494–497`

```tsx
<span className={g.is_correct ? 'text-emerald-600' : 'text-stone-400'}>
  {g.is_correct ? '✓' : '·'}
</span>
```

A correct guess gets a green `✓`. An incorrect guess gets a middle dot in `text-stone-400` — a faint, small glyph that reads more like punctuation than a result indicator. A player skimming their history may not register that those guesses were wrong.

**Minimal fix:** Use `✗` or `×` in `text-stone-400`, or keep `·` but bump colour to `text-stone-500`. The `×` character is distinct from the `✓` in the same size context.

---

### UX-8 · Contribution guess is visually subordinate without explanation `P2`

**File:** `src/app/room/[id]/page.tsx:483–488`

The contribution guess renders at `text-xs text-gray-400` (smaller, dimmer) while final guesses render at `text-sm`. There is no label explaining why the contribution is visually different or that it was submitted in a different phase.

New players seeing the history for the first time may interpret the smaller text as less important or as a system-generated entry.

**Minimal fix:** The `(contribution)` label is already there but is rendered in `text-gray-300` (very faint — passes `not-mono` issue above). Making it `text-gray-400` and adding a brief tooltip or parenthetical "(your submitted word)" would clarify the distinction without adding UI weight.

---

## Letter Bank

### UX-9 · `opacity-35` is not a standard Tailwind value `P1`

**File:** `src/components/LetterBank.tsx:31`

```
'line-through opacity-35 border-gray-300 text-gray-500'
```

Tailwind's default opacity scale is `0, 5, 10, 20, 25, 30, 40, 50…`. `opacity-35` is not included. Unless the project extends the Tailwind config with `35`, this utility class is ignored and eliminated letters render at full opacity — making them visually indistinguishable from neutral letters (only the strikethrough distinguishes them).

**To verify:** Open the game at the `final` phase after submitting a wrong-letter word. All 26 letters in the bank should be clearly split into filled / struck / outlined. If struck-through letters are full opacity, this bug is active.

**Minimal fix:** Change to `opacity-40`:

```
'line-through opacity-40 border-gray-300 text-gray-500'
```

---

### UX-10 · Legend text is ambiguous about "position" `P2`

**File:** `src/components/LetterBank.tsx:43–45`

```tsx
<p className="text-xs text-gray-400 mt-1.5">
  Filled = in word · Faded = not in word
</p>
```

"Filled = in word" could be misread as "filled = correct position" (Wordle habit). The bank only shows presence/absence, not position — confirmed by the comment at the top of the file. The legend is accurate but could cause a brief misread.

**Minimal fix:** "Filled = letter is in the word" or keep as-is with no change (very minor ambiguity).

---

## Delete Vault Placement

### UX-11 · Confirm modal: destructive button is left-aligned `P2`

**File:** `src/app/room/[id]/page.tsx:303–318`

The delete confirmation modal renders:

```
[Delete]  [Cancel]
```

Destructive-action best practice places the confirm action on the right (or requires active effort to reach), since left-to-right reading leads the eye to the first button first. With "Delete" on the left in red, it is the most visually salient element the user sees upon modal open.

The "Begin Game" modal has the same layout (`[Begin] [Cancel]`) which is fine there (non-destructive), but for delete, the order should be swapped.

The overall placement of the delete vault trigger (bottom of page, `text-gray-300`, `mt-16` margin) is well-considered — appropriately hard to find accidentally.

**Minimal fix:** In the delete modal `flex gap-3` div, swap the button order so Cancel comes first:

```tsx
<div className="flex gap-3">
  <button onClick={() => setDeleteConfirm(false)} ...>Cancel</button>
  <button onClick={deleteRoom} className="... bg-red-600 ...">
    {deleting ? '…' : 'Delete'}
  </button>
</div>
```

---

## Error Tone

### UX-12 · Error color is inconsistent between contribution and final phases `P1`

**File:** `src/app/room/[id]/page.tsx:453, 537`

| Context | Class | Colour |
|---------|-------|--------|
| Contribution submit error | `text-red-500 text-xs mt-2` | red |
| Final submit error (`submitError`) | `text-amber-700 text-xs mt-1` | amber |
| Final wrong-guess feedback | `text-amber-700` | amber |

Red signals "something is wrong / blocked." Amber signals "try again / softer failure." For a game, most errors during play (wrong word, already submitted) are recoverable — amber is the right tone. The contribution phase using red for the same category of soft failure is inconsistent.

**Minimal fix:** Change contribution `submitError` display to `text-amber-700`:

```tsx
{submitError && <p className="text-amber-700 text-xs mt-2">{submitError}</p>}
```

---

### UX-13 · Technical error strings can surface directly to players `P2`

The API can return messages like:

- `"Cannot submit guess in phase: reveal"` — exposes internal phase name
- `"Round must be complete or expired"` — technical language
- `"Game has not started yet"` — acceptable
- `"Already submitted contribution guess"` — acceptable

If a race condition or stale UI causes a player to submit in the wrong phase, they see a raw technical error rather than a human-readable explanation. These strings are passed through from route handlers directly to `submitError`/`joinError` with no sanitisation layer.

**Minimal fix:** Add a client-side error translation map for known API error codes, or ensure the API uses consistent human-readable messages. No full solution needed; even replacing the two above with "You can't do that right now." would reduce confusion significantly.

---

### UX-14 · "Processing contributions…" gives no user guidance in reveal phase `P2`

**File:** `src/app/room/[id]/page.tsx:462–467`

```tsx
{room.phase === 'reveal' && (
  <div className="mb-6">
    <p className="text-xs font-medium text-gray-400 mb-1 uppercase tracking-wide">Reveal</p>
    <p className="text-sm text-gray-400">Processing contributions…</p>
  </div>
)}
```

The reveal phase is a transitional state that resolves the moment any player loads the reveal endpoint. But if the polling cycle hasn't fired yet — or if the page is fresh — the user sees "Processing contributions…" with no call to action and no indication of when it will resolve. This can feel like a loading hang.

**Minimal fix:** Add a hint:

```tsx
<p className="text-sm text-gray-400">Hang tight — the vault is about to open.</p>
```

No button or action needed; the 3-second poll will resolve it automatically.

---

## Confirmed Compliant

| Area | Finding |
|------|---------|
| No 6-row grid / green-yellow tiles | ✅ Rail-and-underline approach is fully distinct |
| No animations in game flow | ✅ No transitions on game-state changes |
| Phase label shown in header | ✅ `phaseLabel` displayed top-right on all vault views |
| Streak count visible | ✅ Shown in header and dashboard cards |
| Players-locked state visible | ✅ Lobby shows "N of M locked in" in contribution phase |
| Confirm before begin game | ✅ Modal with player count |
| Confirm before delete | ✅ Modal with "cannot be undone" copy |
| Error display inline (not modal) | ✅ All game-flow errors shown near action |
| No heavy styling / gradients / shadows | ✅ Flat, minimal palette throughout |

---

*Generated by QA-UX agent · Churro repo · 2026-03-03*
