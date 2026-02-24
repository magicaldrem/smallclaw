# Execute Mode AI-First V2 Plan

## Status Update (2026-02-20)

This document is now both the plan and the implementation reference for the current AI-first execute flow.

### Implemented

- AI-first execute routing is active.
- Native tool-calling is the primary execute path.
- `open_confirm` execute -> discuss handoff exists for destructive operations.
- Pending confirmation state is tracked and resumable.
- Final chat summary after execute is enabled as a default behavior.
- Final chat summary applies to web-triggered execute runs too.
- Execute prompts include "inspect first, do not assume structure" guardrails.
- Format-violation tolerance was increased to reduce premature hard loops.
- Post-execute finalize retries once, then uses guaranteed fallback final chat if model finalize is empty/invalid.
- Web synthesis failure now attempts an AI rescue summary from web evidence before deterministic fallback.

### Still Being Tuned

- Small-model formatting drift under long/ambiguous requests.
- Occasional discuss/execute latency spikes.
- Occasional execute answers that are too raw (tool JSON shown directly) instead of concise user-facing summary.
- Source-grounded web summary quality when snippets are sparse/noisy.

### Operator Rule

- Keep this AI-first.
- Deterministic mappings stay fallback-only safety nets, never primary planning.

## Goal

Improve LocalClaw execute-mode reliability for small local models while preserving AI-first behavior:

1. Discuss stays default.
2. AI decides tool calls in execute.
3. No deterministic tool-routing takeover.
4. Destructive operations can safely hand off to discuss for confirmation.
5. After execute, user always gets a conversational final chat summary.

## Current Issues

- Execute can hit `FORMAT_VIOLATION_LOOP` on small models when output format drifts.
- Destructive confirmation intent has no explicit execute -> discuss handoff path.
- Model can "want to ask" in execute, but runtime expects tool/final protocol and may block.

## Design Principles

- AI-first orchestration, system-enforced safety.
- Minimal control tokens, explicit and predictable.
- Small context payloads and short prompt contracts for 4B-class models.
- Recovery should prefer graceful clarification over hard block.

## Control Tokens

- Discuss -> Execute: `open_tool`
- Discuss -> Web: `open_web`
- Discuss -> Plan: `open_plan`
- Execute -> Discuss confirmation handoff: `open_confirm` (new)

`open_confirm` is not a tool call. It is a control signal that tells runtime:

- Do not execute destructive mutation yet.
- Switch back to discuss/chat.
- Ask user for explicit yes/no confirmation.

## Session State Additions

Add `pendingConfirmation` to agent session state:

- `id`
- `requested_at`
- `source_turn_id`
- `question`
- `original_user_message`
- `resume_message`

This lets runtime resume the exact execute objective after user confirmation.

## Execute -> Discuss Confirmation Flow

1. Execute model returns a final response containing `open_confirm`.
2. Runtime parses signal from execute reply (and execute thinking context when available).
3. Runtime stores `pendingConfirmation`.
4. Runtime switches session mode back to discuss.
5. Runtime returns a confirmation question to user.

Next turn:

- If user says yes -> clear pending confirmation and rerun execute using `resume_message`.
- If user says no -> clear pending confirmation and return cancellation message.
- If user sends unrelated task -> clear stale pending confirmation and continue normally.

## Small-Model Stability Improvements

1. Keep execute prompts concise, explicit, and operational.
2. Add explicit `open_confirm` instruction in execute prompts for destructive actions.
3. Keep native tool-calling primary.
4. Reduce hard failures:
   - increase execute format-violation fuse in AI-first cycle from `1` to `2`.
   - prefer clarification/handoff over repeated format loops.
5. Keep final chat summary always enabled.

## Tool Selection in Execute (How It Chooses)

1. Discuss emits escalation trigger (`open_tool`, `open_web`, `open_plan`).
2. Runtime switches to execute and builds execute context.
3. Execute model chooses tool calls from exposed Node tool schemas.
4. Runtime executes returned tool call(s) and feeds results back into execute.
5. Execute model returns a grounded final result.
6. Runtime returns to discuss-style final chat summary for user-facing response.

Important: tool choice should come from model reasoning over context and tool schema, not keyword-only backend routing.

## Web Execute Finalization (Updated)

For `open_web`-triggered execute runs:

1. Execute runs `web_search` and captures tool output.
2. Runtime attempts normal synthesis.
3. If synthesis fails, runtime performs one AI rescue-summary pass using captured web evidence (`results`/`facts`/raw output).
4. Deterministic fallback text is only used if rescue also fails.
5. Runtime still appends post-execute `Final chat` so users get a conversational completion line.

## Confirmation Handoff Contract

For destructive operations in execute:

1. If no explicit user confirmation in latest intent context, model returns `open_confirm` with a short yes/no question.
2. Runtime stores pending confirmation and switches to discuss.
3. User reply:
   - yes -> resume execute objective
   - no -> cancel safely
   - unrelated -> clear pending confirmation and continue normal routing

## Prompt Contract (Execute)

Add to execute prompt instructions:

- For destructive operations (delete/remove/overwrite/bulk rename):
  - if user has not explicitly confirmed in latest request, do not execute mutation.
  - return a short confirmation question and include token `open_confirm`.

## Implementation Scope

### Server (`src/gateway/server.ts`)

- Add pending confirmation state type + persistence restore.
- Add execute-control signal parser for `open_confirm`.
- In `sseDone`, parse `open_confirm` and trigger discuss handoff.
- Skip task auto-complete when waiting on confirmation.
- Add yes/no resolution logic before routing pipeline:
  - yes => resume execute with stored message
  - no => cancel
  - unrelated => clear stale pending confirmation
- Use resumed execute objective for learning/task summaries.

### Reactor (`src/agents/reactor.ts`)

- Update execute prompt instructions to include `open_confirm` behavior.
- Keep native tool calls primary.

### Build/Verification

- TypeScript build passes.
- Manual checks:
  1. non-destructive execute path still works.
  2. destructive request triggers confirmation question.
  3. yes resumes execute and performs mutation.
  4. no cancels safely.
  5. final chat still appears after execute (including web-triggered runs).
  6. web synthesis failure attempts AI rescue summary before deterministic fallback.

## Non-Goals (This Phase)

- No deterministic delete routing expansion.
- No new approval DB workflow/UI gating changes.
- No policy-engine rewrite.

## Success Criteria

- No more destructive-operation deadlock in execute.
- Confirmation is explicit and resumable.
- Small-model execute loop has fewer hard format-loop failures.
- System remains AI-first and trigger-driven.
