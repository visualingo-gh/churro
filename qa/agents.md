# QA Agents

These are structured prompts for Claude Code to run QA checks.

---

## QA-SPEC (Rule compliance)

Audit the repository against CLAUDE.md.

Find mismatches between:
- game rules
- UI requirements
- lobby behavior
- expiration logic
- presence logic

Output:

- severity (P0/P1/P2)
- reproduction steps
- suspected file/function

Do NOT suggest new features.

---

## QA-UX (Clarity & mobile)

Review UI against CLAUDE.md.

Focus on:

- dashboard cards
- entry rail clarity
- guess history
- letter bank readability
- button affordances
- error tone
- delete vault placement

Output top UX issues with minimal fixes.

---

## QA-EDGE (Break things)

Attempt to break the system.

Test:

- submitting guesses in wrong phase
- exceeding guess limits
- joining after roster lock
- accessing deleted vault
- submitting after expiration

Output exploit steps + server-side guard suggestions.

---

## QA-TEST (Engine tests)

Create vitest tests for core game logic.

Focus on:

- knowledge derivation
- guess limits
- phase transitions
- expiration behavior

If needed, refactor logic into pure functions.

No UI tests.

---

## QA-TRIAGE (Fix planning)

Combine results from:

- QA-SPEC
- QA-UX
- QA-EDGE

Produce:

P0 – ship blockers  
P1 – next improvements  
P2 – polish

Provide an ordered patch plan.