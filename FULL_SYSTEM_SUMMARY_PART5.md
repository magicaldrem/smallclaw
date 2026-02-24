# FULL SYSTEM SUMMARY — PART 5 (Skills Compatibility + Runtime Safety)

Date: 2026-02-19
Project: LocalClaw

## What was implemented

### 1) Canonical skill storage and processing (already integrated, now validated)
- Skills use project-local canonical root: `.localclaw/skills/<skill_id>/`
- Generated artifacts per skill:
  - `SKILL.md` (source)
  - `PROMPT.md` (small-model injection pack)
  - `skill.json` (hard manifest)
  - `RISK.json` (preflight/risk report)
- Install/upload/list/inspect/enable/rescan/remove flow is unified through the same processor pipeline.

### 2) Selective skill prompt injection (context control)
- Added deterministic skill selection for each turn:
  - `selectSkillSlugsForMessage(message, max=2)` in `src/config/soul-loader.ts`
- System prompt now injects only selected skills (instead of all installed skills by default), reducing prompt bloat and improving Qwen 4B reliability.
- Selection trace is emitted in decision trace (`routing` event with selected skills).

### 3) Safe template-based skill execution
- Added new runtime/tool primitive: `skill_exec`
- Implemented in `src/tools/skills.ts` with strict guards:
  - skill exists and is enabled
  - setup requirements satisfied (binaries/env/files)
  - template match by `action` or exact `command`
  - placeholder rendering with required-arg checks
  - blocked shell operator checks (`|`, `&&`, `||`, redirection, backticks, subshell/chaining)
  - allowlisted binary check against manifest
  - template-shape verification
  - confirmation gates for sensitive actions
  - dry-run support (`dry_run:true`)
- On success, executes through existing shell tool policy (`executeShell`) to reuse workspace permissions and existing shell safety.

### 4) API expansion for skills runtime
- Added endpoint:
  - `POST /api/skills/:slug/exec`
- Existing skills API retained:
  - list/search/install/upload/inspect/enable/rescan/remove

### 5) Registry wiring
- Registered `skill_exec` in tool registry (`src/tools/registry.ts`).
- Reactor prompt guidance updated to prefer `skill_exec` over raw shell for installed skill commands.

### 6) Housekeeping and consistency
- Skill removal now removes lock entry from `.localclaw/.clawhub/lock.json`.
- Build and tests pass after all changes:
  - `npm run build --silent` ✅
  - `npm test --silent` ✅ (`golden-routing: all checks passed`)

## Files changed in this phase
- `src/config/soul-loader.ts`
- `src/tools/skills.ts`
- `src/tools/registry.ts`
- `src/gateway/server.ts`
- `src/agents/reactor.ts`
- `FULL_SYSTEM_SUMMARY_PART5.md` (new)

## Notes
- This closes the core compatibility loop for OpenClaw-style SKILL.md ingestion while preserving small-model safety.
- Next test focus should be end-to-end `skill_exec` scenarios (template render, confirm-gated action, needs-setup behavior).

---

## Update — Post-Phase Reliability Hardening

Date: 2026-02-19 (latest)

### What was added after the skills phase
- **Task lifecycle hardening**
  - Added centralized turn-to-task completion (`completeTaskForTurn`) with:
    - title-match-first completion
    - newest `in_progress` fallback
    - explicit failed-state marking
  - Final task state binding is now handled in turn finalization (`sseDone`) for cleaner UI consistency.

- **File-op routing upgrades**
  - Added explicit style-op turn routing so prompts like:
    - `change the background to red`
    - `set the background blue`
    route to execute/file-op behavior when HTML context exists.

- **Content extraction fixes**
  - Hardened requested-content parsing for complaint phrasing like:
    - `it doesn't say X, it only says Y`
  - Reduced accidental capture of full complaint tails into file content.

- **Memory/fact hygiene**
  - Added stronger junk-claim/failure filtering in memory write paths.
  - Added fact-store pruning and startup prune hook.
  - Added session fact TTL normalization/enforcement to reduce stale carryover.

- **Workspace state grounding**
  - Added workspace ledger updates tied to file create/delete tracking to improve follow-up target resolution and reduce stale-file hallucinations.

- **Prompt/context safeguards**
  - Added anti-invention instructioning in chat/discuss prompt assembly.
  - Added intent-tiered memory injection and tighter daily snippet caps to reduce context pressure on small models.

- **Queue/UI safety**
  - Queue auto-run now pauses on failed/blocked turns to prevent cascading confusion.

### Validation snapshot
- `npm run build --silent` ✅

### Current status
- Skills compatibility and runtime safety remain in place.
- Post-phase reliability layer is now integrated on top (task lifecycle, memory hygiene, style routing, queue safety).

---

## Update — Deterministic Reliability Pass

Date: 2026-02-20

### Implemented in this pass
- Added new feature flags in `src/gateway/server.ts`:
  - `LOCALCLAW_FF_PREFIX_DELETE`
  - `LOCALCLAW_FF_STRUCTURAL_HTML`
  - `LOCALCLAW_FF_ATTRIBUTION_FETCH`
  - `LOCALCLAW_FF_RETRY_REPLAY`
- Added decision telemetry counters and API exposure (`/api/agent/session/:id`) for:
  - `discuss_when_should_execute`
  - `unsupported_mutation`
  - `format_loop`
  - `ambiguous_target`
  - `missing_required_input`
  - `verify_failed`
  - `wrong_target`
- Added deterministic retry replay for retry-only prompts (`try again` / `retry`) to re-run latest failed execute objective.
- Added prefix-group delete support in deterministic batch parsing:
  - phrases like `delete all files that start with golden...`
- Added structural HTML mutation path (panel-wrap intent):
  - detects layout requests (`panel/card/box/wrap`) and applies non-destructive structural rewrite.
- Added visible-text-loss guard for HTML style/structural rewrites to prevent destructive content wipes.
- Added attribution fetch gate for web synthesis:
  - attribution-sensitive questions now auto-fetch top source when snippets lack direct attribution evidence.
- Added memory hardening in `src/gateway/memory-manager.ts`:
  - `addMemoryFact(...)` now uses `shouldDiscardClaim(...)` filtering.
  - temporal claims are forced to `session` scope to reduce stale long-lived facts.
- Extended `tests/golden-routing.ts` with new coverage for:
  - plural file-op routing
  - prefix delete
  - structural panel mutation
  - retry replay behavior

### Validation
- `npm run build --silent` ✅
- Targeted runtime checks (manual scripted assertions for text-color edit, prefix delete, structural panel mutation, retry replay) ✅
- `npm test --silent` currently stalls during golden run around checkpoint 32 (investigation still open; not resolved in this pass).

### Additional update (reactor/runtime)
- Added optional native tool-calling first-pass in `src/agents/reactor.ts` (env: `LOCALCLAW_NATIVE_TOOL_CALLS`, default enabled):
  - Uses Ollama chat tools API first.
  - Falls back automatically to existing text protocol loop if native path fails.
- Added chat-tool definitions in `src/tools/registry.ts`:
  - `getToolDefinitionsForChat()` emits function schemas for all registered tools.
- Added chat wrapper in `src/agents/ollama-client.ts`:
  - `chatWithThinking(...)` with think fallback behavior similar to `generateWithThinking(...)`.

### Additional update (self-heal skill autowrite)
- Added repaired-turn auto-skill generation in `src/gateway/server.ts`:
  - New feature flag: `LOCALCLAW_FF_SELF_HEAL_SKILL` (default enabled).
  - On finalized `repaired` execute turns, system extracts the last successful deterministic tool call and writes a compact `SKILL.md` pack through `writeSkillPackFromContent(...)`.
  - Skill IDs are deterministic (`auto_repair_<tool>_<hash>`) and cooldown-gated to avoid spam.
  - Adds trace + daily memory note when a skill is generated.
  - Emits SSE info event when a self-heal skill is learned.

### Additional update (small-model optimization + safety)
- Removed hardcoded instant greeting reply in discuss mode to avoid swallowing mixed prompts (e.g., `hey, do X`).
- Added small-model inference tuning knobs in `src/gateway/server.ts`:
  - `LOCALCLAW_DISCUSS_NUM_CTX`, `LOCALCLAW_DISCUSS_NUM_PREDICT`, `LOCALCLAW_DISCUSS_THINK`
  - `LOCALCLAW_CHAT_NUM_CTX`, `LOCALCLAW_CHAT_NUM_PREDICT`, `LOCALCLAW_CHAT_THINK`
- Discuss and plain-chat generation now use these lower-latency defaults for Qwen3:4b.
- Extended no-fake-action guard to plain chat replies as well (not only discuss-chat path).
- Added prompt budget caps in `src/config/soul-loader.ts` with env overrides:
  - total/soul/memory/skills/extra char budgets and truncation markers.
- Improved native tool-calling schemas in `src/tools/registry.ts`:
  - heuristic type inference for boolean/number/json-like params instead of all-string schemas.
- Strengthened self-heal governance:
  - auto-skill generation now skips low-signal short objectives,
  - focuses on mutation-relevant tools,
  - prunes older `auto_repair_*` skills (keeps latest set).
