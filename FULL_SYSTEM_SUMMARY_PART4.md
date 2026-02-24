# LocalClaw - System Summary (Part 4)

Last updated: 2026-02-19 (current implementation pass + parser/path-guard hotfixes)

This document captures the latest reliability-focused build wave after `FULL_SYSTEM_SUMMARY_PART3.md`, centered on:
- deterministic file-op execution stability (Qwen3:4b-friendly),
- hard verification and blocked outcomes,
- multi-step clause handling,
- reactor loop safety,
- and execution/watchdog telemetry for the Agent Context UI.

---

## 1) Why this wave happened

Recent logs showed repeated failure patterns:

1. File-op turns were correctly recognized, but deterministic matching missed some intents (especially HTML style edits like "change background to red").
2. Missed deterministic match would fall into reactor too early, which caused format-violation loops.
3. Multi-step prompts often executed only one clause (e.g. delete happened, edit didn’t).
4. Ambiguous target resolution ("the html file", "it", "that file") sometimes guessed wrong.
5. Success replies were occasionally returned without strong post-action verification.
6. Editing requests could implicitly create new files in edge-cases.

This wave implemented a deterministic-first control plane to prevent those failures.

---

## 2) New "north star" rules now in code

For FILE_OP turns:

1. No reactor before deterministic ladder exhaustion.
2. No success response unless verify passes (hard gate).
3. No implicit file creation during edit/delete intents.
4. One deterministic repair retry max on verify failure.
5. If still unresolved, return canonical `BLOCKED (...)` with structured reason.

---

## 3) Core backend changes

## 3.1 `src/gateway/server.ts`

### A) Blocked outcome model added

- New reason family:
  - `AMBIGUOUS_TARGET`
  - `UNSUPPORTED_MUTATION`
  - `VERIFY_FAILED`
  - `FORMAT_VIOLATION_LOOP`
  - `MISSING_REQUIRED_INPUT`
- Canonical formatter:
  - `buildBlockedFileOpReply(...)`
  - Produces consistent `BLOCKED (...)` output with:
    - what was tried
    - exact input needed
    - optional suggested next prompt

### B) Multi-step parser upgraded (quote-safe)

- Added `splitInstructionClauses(message)`:
  - splits on `then`, `after that`, `and then`, `also`
  - does not split inside quoted strings
  - can split punctuation boundaries when next clause starts with an action verb
- Replaced multiple ad-hoc split paths with this function.

### C) Deterministic HTML/CSS style mutation path

Added deterministic helpers:

- `detectHtmlStyleMutationIntent(...)`
  - extracts style mutation intent (`panel` vs `page`) + target color.
- `rewriteHtmlStyleByIntent(...)`
  - applies bounded deterministic rewrites:
    - CSS variable replacement (`--bg`, `--panel`)
    - body/panel block rewrite
    - style rule injection fallback
    - inline body style fallback
- Supporting primitives:
  - `replaceCssVariable(...)`
  - `rewriteCssBackgroundInBlock(...)`
  - `injectStyleRule(...)`
  - `applyInlineBodyBackground(...)`

### D) Deterministic target resolution/scout behavior

- Added `resolveHtmlTargetForMutation(...)` with priority:
  1. explicit filename(s) in prompt
  2. referential cue + last html file
  3. recent html files
  4. bounded workspace html scan
  5. ambiguity/missing -> blocked/clarify behavior

### E) Single-overwrite inference hardening

- `inferDeterministicSingleFileOverwriteCall(...)` now handles style-edit intents deterministically.
- Fixed false filename extraction bug:
  - phrase `"the html file in your workspace"` no longer mis-parses as filename `"in.html"`.
  - tightened "named/called/file named/file called" extraction rules.

### F) No-op + no-implicit-create guardrails

- Added `isWriteNoOpCall(...)`
  - skips redundant writes and returns "already set" style behavior.
- Added `shouldBlockImplicitWrite(...)`
  - blocks writes that would create new file during non-create intents.

### G) Verify/repair gate tightened

- `verifyAndRepairDeterministicFileOps(...)` now enforces:
  - verify
  - deterministic repair (max once)
  - verify again
  - if still failing -> blocked/failure path

### H) File-op fallback ladder inserted before reactor

In execute flow, when file-op intent is true and direct deterministic call is empty:

1. deterministic scout
2. deterministic mutate plan
3. execute
4. verify/repair
5. success or canonical blocked

This reduces dependence on free-form reactor tool formatting for imperative file actions.

### I) Turn failure detection improvements

- `isFailureLikeFinalReply(...)` now marks `BLOCKED` replies as failure-like for consistent task status handling.

### J) Heartbeat/watchdog telemetry (runtime-level)

- Added per-turn progress tracking and SSE heartbeat events for:
  - soft/hard stall signaling
  - format violation retry context
- Designed as watchdog telemetry, not reasoning.

---

## 3.2 `src/agents/reactor.ts`

- Added configurable `formatViolationFuse` in `ReactOptions`.
- Enforced 2-strike fuse (default):
  - if format violations hit threshold with heuristic routing disabled, reactor returns:
    - `BLOCKED: FORMAT_VIOLATION_LOOP ...`
- Emits step telemetry when fuse trips.

---

## 3.3 `tests/golden-routing.ts`

Test suite now includes new coverage for this wave:

1. Generic HTML background style edit resolves deterministically (no reactor required).
2. Quote-safe clause splitting preserves quoted text containing connector phrases.

Additional harness updates:
- import compatibility (`default || mod`) for API exports
- forced process exit on success path

---

## 4) Current behavior (expected outcomes)

Given prompts like:

1. "change the background color of the html file in your workspace to red"
   - resolves html target deterministically
   - rewrites CSS/HTML deterministically
   - verifies result before success

2. "remove note.txt and then change index.html panel background to red"
   - splits into ordered clauses
   - executes both deterministic steps
   - verifies mutation outcomes

3. "edit this file ..." (ambiguous and multiple candidates)
   - returns clarify/blocked-style response instead of guessing

4. repeated "set to red" when already red
   - no-op detection avoids unnecessary write

---

## 5) Validation state (this pass)

Commands run:

1. `npm test --silent`
   - result: `golden-routing: all checks passed`

2. `npm run build --silent`
   - result: success (TypeScript build passed)

---

## 6) What remains / next recommended step

This wave closes the planned deterministic reliability gap for file-op handling.

Recommended next step:

1. Add UI rendering for heartbeat/watchdog events (if not already wired end-to-end) so right-column process visibility matches backend telemetry.
2. Add more goldens around ambiguous target clarification and blocked reason correctness.
3. Add a small integration test for "edit/delete must not create" behavior to lock the invariant.

---

## 7) Practical takeaway

LocalClaw is now substantially less reliant on raw LLM tool-call formatting for imperative file operations.  
The runtime is now the primary controller for file-op correctness via deterministic ladder, verify gates, blocked contracts, and loop fuses.

---

## 8) Incremental fixes after Part 4 (same day hotfix pass)

These were applied after the initial Part 4 write-up to close real log regressions from live testing.

### A) Deterministic parser hardening for follow-up edits

In `src/gateway/server.ts`:

1. Prevented batch create over-match on edit phrasing:
   - create-clause parsing no longer treats phrases like `"make it say ..."` as file creation when the clause is clearly edit/update intent.
2. Prevented synthetic filename bug:
   - phrases like `"the html file"` no longer synthesize `the.html`.
3. Extended follow-up detection:
   - `"make it just say ..."` now routes as file-op follow-up (execute path), not discuss.
4. Improved content extraction for correction language:
   - supports `"it should just be ..."` / `"it should be ..."`
   - strips trailing context fragments like `"it currently says ..."` from captured target content.
5. Disabled HTML truncation in batch create:
   - 140-char cap now applies only to non-HTML payloads, avoiding malformed HTML writes.

### B) Windows path-guard fix for deterministic scout/read

In `src/tools/files.ts`:

1. Replaced case-sensitive `startsWith` path checks with boundary-safe path containment:
   - introduced `isPathInside(base, target)` using `path.relative(...)`
2. Added Windows-safe comparison normalization:
   - drive-letter/case normalization via `normalizePathForCompare(...)`
3. Result:
   - valid workspace paths like `D:\localclaw\workspace\Testing.html` are accepted even when allowed path is configured as `d:\localclaw\workspace`.

This directly fixes the observed runtime failure:
- `ERROR: Path is not in any allowed directory. Allowed: d:\localclaw\workspace`
when attempting read on an existing workspace file.

### C) Golden test updates

In `tests/golden-routing.ts`:

1. Added Golden 25:
   - `"nice lol, make it just say \"hello world\""` must deterministically overwrite the prior HTML file.
2. Added Golden 26:
   - html text edit phrasing must not create `the.html` or spawn unintended batch-create writes.
3. Added Golden 27:
   - batch HTML create content must not be truncated.
4. Hardened Golden 20:
   - target-specific delete assertion (`index.html`) to avoid workspace-state flakiness.

### D) Validation (post-hotfix)

1. `npm test --silent` -> `golden-routing: all checks passed`
2. `npm run build --silent` -> success

Additionally verified with targeted repro scripts:
- path-guard uppercase/lowercase drive-letter scenario succeeds
- exact user-prompt regressions now resolve to deterministic overwrite behavior.
