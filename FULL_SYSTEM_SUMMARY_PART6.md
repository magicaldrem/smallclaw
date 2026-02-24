# FULL SYSTEM SUMMARY - PART 6 (User-Planned Model-Led Mode Switching)

Date: 2026-02-20
Project: LocalClaw
Status: Planning only (no code edits in this phase)

## Core direction (user-defined)

This plan is intentionally model-led:

- Every turn starts in `discuss/chat` by default.
- The model decides whether it needs tools/web execution.
- The switch is triggered by model-emitted trigger words/phrases.
- Backend detects the trigger and force-reruns in the proper mode.
- After the turn completes, default mode returns to `discuss/chat`.

No separate user-facing mode toggle is required.

## Why this plan

Primary goals:

- Keep one unified chat experience for normal conversation + task execution.
- Let the model self-initiate execution mode changes.
- Preserve current process log visibility while improving "do what I asked" reliability.
- Enable a self-learning loop from user corrections and successful retries.

## Planned runtime flow (exact behavior)

1. User sends message.
2. System runs first pass in `discuss/chat` (default behavior).
3. Model responds (visible response + thinking available in process telemetry).
4. System scans for known trigger words in model output (response and/or thinking).
5. If no execution trigger is found:
   - Turn completes as chat.
6. If execution trigger is found:
   - System force-switches mode and re-runs turn in the mapped mode (`execute` or `web`).
7. Execution/web pipeline runs with existing tool system and logs.
8. Post-run behavior:
   - File/tool operations: return to `discuss` and generate a final natural-language completion line.
   - Web operations: no third pass; return the web-result response directly (two-stage only).
9. Reset default mode to `discuss/chat` for the next user message.

## Trigger-word strategy (model-driven)

The model is instructed in runtime context to use trigger words when a non-chat action is needed.

Requirements:

- Trigger vocabulary is explicit and short.
- Matching is tolerant to casing/punctuation/underscore variation.
- Trigger detection works even if trigger appears in model "thinking" content.
- A single reroute cap is used per turn to prevent looped reruns.

## UI behavior (single assistant block, no second avatar)

One assistant message block should contain staged sections:

1. Initial discuss/chat response (from first model pass).
2. Process log section (including thinking, mode switch, and tool steps).
3. Execution response section (example: `Updated index.html (html_set_primary_text).`).
4. Final discuss-style confirmation section (file/tool flow only).

For web turns:

- Show initial discuss section + process + web response section.
- Skip the final third discuss confirmation section.

This keeps one visual response unit while still showing two/three internal stages.

## Self-improvement and skill-learning loop

Target behavior:

1. Model executes and claims completion.
2. User says it failed (example: "No, it didn't work").
3. System uses immediate turn context + logs + prior failed action path to retry differently.
4. When retry succeeds:
   - Save successful repair pattern to memory.
   - Link failed pattern and corrected pattern.
5. If similar repair succeeds repeatedly:
   - Promote that repair strategy into a reusable skill.
   - Prefer that learned skill path first for similar future requests.

This makes correction-driven adaptation part of normal operation.

## Process/memory artifacts to store per turn

For each actionable turn, store:

- Original user request.
- First-pass discuss response.
- Detected trigger and chosen switched mode.
- Tool path used (actions and parameters).
- Verification outcome (pass/fail/repaired).
- User correction signal (if any).
- Final successful method (if repaired).
- Candidate skill promotion metadata.

## Scope boundaries for this plan

Included:

- Discuss-first default behavior.
- Model-triggered mode switching.
- Single-block UI staging.
- Correction-driven memory + skill promotion.

Not included in this plan:

- Replacing the system with JSON-only router contracts.
- Requiring special structured control tags as mandatory output.
- Reintroducing manual mode toggle as the primary user control.

## Acceptance criteria (planning targets)

1. A normal greeting remains chat-only with no forced execute.
2. A task request can start in chat, then auto-switch to execute/web based on model trigger.
3. UI shows one assistant block with staged internals (no second avatar bubble).
4. File/tool turns include a final chat confirmation after execution.
5. Web turns stop at two-stage response (no third summarize pass).
6. "Didn't work" corrections trigger retry with context-aware repair behavior.
7. Repeated successful repairs are promoted into skill candidates.

## Summary

This is a deliberate "discuss-first, model-decides-switch" architecture:

- Unified chat UX
- Automatic mode switching by model triggers
- Existing tool/process logs preserved
- Built-in path to self-learning via correction -> repair -> skill promotion

---

## Implementation Snapshot (Initial Wiring Complete)

Date: 2026-02-20

Implemented in `src/gateway/server.ts`:

- Added feature flags for model-trigger switching and post-exec chat finalization.
- Added model-trigger detection helpers (response/thinking scan for execute/web triggers).
- Forced discuss-first turn intent when model-trigger mode is enabled.
- Added discuss-pass trigger interception that switches into execute flow in-turn.
- Added web trigger mapping to forced web_search route in execute path.
- Added staged single-block reply composition:
  - initial discuss response
  - execution response
  - optional post-exec chat finalize sentence (skipped for web-only turns)
- Added explicit SSE mode-switch event when discuss -> execute is triggered by model output.
- Added end-of-turn reset back to discuss mode in session state.

Validation:

- `npm run build --silent` passes.

- Added compact "Recent verified tool actions" discuss/coach prompt context (gated):
  - injects last execute tool outcomes for referential/correction/tool-oriented turns.
  - skipped for greeting/reaction chat to avoid context pollution.

---

## Implementation Snapshot (Phase 3 - Corrective Replay + Discuss Guardrails)

Date: 2026-02-20

Implemented:

- Added corrective replay routing for ambiguous feedback turns (example: "you didn't list them correctly").
- Added tool-aware replay recovery:
  - resolves to the latest matching execute objective by tool path (currently used for `list` retries).
- Added fallback corrective replay objective for workspace listing:
  - `List the current files in the workspace.`
- Expanded retry cue detection for listing-correction phrasings.
- Improved discuss-response sanitization:
  - prevents false "no access" claims in workspace/file context.
  - prevents false completion claims before execution.
- Added staged discuss-draft sanitizer for discuss -> execute trigger switches:
  - normalizes misleading first-pass chat into neutral execution handoff text.
- Added routing latency optimization:
  - skips `inferTurnPlan` LLM planner pass when model-trigger mode is enabled.
  - keeps discuss-first behavior while removing a frequent pre-mode delay.

Expected impact:

- Reduces cases where corrective user feedback falls into reactor `FORMAT_VIOLATION_LOOP`.
- Increases deterministic recovery for "try again / wrong list / not correct" follow-up turns.
- Keeps staged UI responses consistent with actual execution state.

Validation:

- `npm run build --silent` passes.

---

## Implementation Snapshot (Phase 2 - Learning + UI)

Date: 2026-02-20

Implemented:

- Added persistent self-learning store in `.localclaw/self_learning.json`.
- Added per-turn learning records:
  - objective key
  - final status
  - correction/retry cues
  - model trigger token
  - primary tool path
- Added pattern counters for:
  - failures
  - repaired successes
  - correction-driven repairs
  - model-trigger repairs
- Added promotion gating for auto-skill generation:
  - repair patterns must be correction/model-trigger grounded and repeated (`>=2` repairs by default) before automatic promotion.
- Added promotion back-link into learning store (`promoted_skill_id`).
- Updated chat UI rendering to show staged assistant content in one message block:
  - `Initial chat`
  - `Execution result`
  - `Final chat`
- Updated process log rendering of `agent_mode` events to include mode-switch metadata:
  - `switched_from`
  - `route_target`
  - `trigger`

Validation:

- `npm run build --silent` passes.

