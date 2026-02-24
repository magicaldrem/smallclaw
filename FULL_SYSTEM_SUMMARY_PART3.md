# LocalClaw - System Summary (Part 3)

Last updated: 2026-02-18 (latest pass)

This document captures the latest implementation wave after `FULL_SYSTEM_SUMMARY_PART2.md`, with emphasis on:
- memory architecture hardening,
- conversation vs execution routing behavior,
- deterministic grounding flow,
- and end-to-end search diagnostics logging in the UI.

## 1) Memory System (Current State)

## 1.1 Unified memory write decision path

Implemented in `src/gateway/memory-manager.ts`:

- Added a single memory decision function:
  - `decideMemoryWrite(claim) -> DISCARD | DAILY_NOTE | TYPED_FACT | CURATED_PROFILE`
- Added normalized claim contract in `MemoryClaim`:
  - `claim`, `type`, `scope`, `workspace_id`, `agent_id`, `session_id`, `source_kind`, `source_ref`, `confidence`, `ttl_hours`
- Added explicit write policy:
  - `DISCARD` for low-value/invalid claims (too short, error/protocol-like text).
  - `DAILY_NOTE` when source metadata is missing or confidence is low.
  - `TYPED_FACT` for grounded claims (`confidence >= 0.55`).
  - `CURATED_PROFILE` only for strong global preference/rule claims (`confidence >= 0.9`).

## 1.2 Durable stores and destinations

Now split behavior is explicit:

- Daily log: append-only
  - `workspace/memory/YYYY-MM-DD.md`
  - via `appendDailyMemoryNote(...)`
- Typed fact store:
  - via `upsertFactRecord(...)` in `src/gateway/fact-store.ts`
  - includes scope + source metadata + timestamps + confidence
- Curated profile writes:
  - still go through controlled upsert path (not free-form dump)

## 1.3 Typed fact model + conflict handling

Strengthened in `src/gateway/fact-store.ts`:

- Supports:
  - `workspace_id`, `agent_id`, `session_id`
  - `type`, `scope`
  - `source_kind`, `source_ref`, `source_tool`, `source_url`
  - `verified_at`, `expires_at`, `confidence`, `actor`
- Upsert matching includes scope boundaries to reduce cross-project bleed.
- Query scoring prioritizes:
  - freshness,
  - relevance,
  - and user-sourced facts when conflicts occur.

## 1.4 Memory injection changes

In `src/config/soul-loader.ts`:

- System prompt no longer blindly injects full memory blob.
- Injects only curated profile-like bullets from `memory.md`:
  - lines tagged as `[rule]`, `[profile]`, `[preference]`, or `key=profile:/key=rule:`.

In `src/gateway/server.ts`:

- Typed facts and recent daily snippets are injected with scoped filtering.
- Runtime date/time instruction is included so stale priors are treated cautiously.

---

## 2) Mode Routing and Conversation Behavior

## 2.1 Reaction/conversation gates (deterministic-first)

Implemented in `src/gateway/server.ts`:

- Added:
  - `isConversationIntent(...)`
  - `isReactionLikeMessage(...)`
- These gates force discuss behavior for reactional/phatic turns and reduce unnecessary tool calls.

## 2.2 Explicit user overrides

Implemented in `src/gateway/server.ts`:

- `/chat ...` forces discuss mode.
- `/exec ...` forces execute mode.

This gives deterministic control when classifier confidence is ambiguous.

## 2.3 Discuss-to-execute promotion remains

- Discuss drafts can still auto-promote when needed (`shouldPromoteDraftToExecute` + NL tool router).
- Promotion event is surfaced as:
  - `Discuss draft promoted to execute (...)`

---

## 3) Grounded Execute Flow (What actually writes memory now)

Execute pipeline in `src/gateway/server.ts` now follows:

1. Run tool loop / routed tool calls.
2. Build grounded candidate from:
   - structured tool facts first,
   - then extracted sentence from tool output,
   - then fallback answer text.
3. Apply memory safety + freshness checks.
4. Persist using `persistMemoryClaim(...)` with scope/source metadata.

Important behavior:
- No raw sub-answer dump directly to long-term memory.
- Web-derived writes are policy-gated by freshness + `auto_store_web_facts`.
- Objective completion and flush events write compact daily notes.

---

## 4) Search Pipeline Diagnostics (New in this phase)

## 4.1 Provider-attempt trace in `web_search`

Implemented in `src/tools/web.ts`:

- Added `search_diagnostics` object to tool output:
  - `query`
  - `preferred_provider`
  - `provider_order`
  - `attempted[]` where each entry records:
    - `provider`
    - `status` (`success | failed | skipped`)
    - `reason` (for fail/skip)
    - `duration_ms`
    - `result_count` (when successful)
  - `selected_provider`

- Diagnostics are attached for both:
  - successful search results
  - all-provider failure responses

This makes fallback behavior inspectable instead of opaque.

## 4.2 SSE propagation of diagnostics

Implemented in `src/gateway/server.ts`:

- `tool_result` SSE now includes diagnostics for `web_search`.
- `step` objects preserve `toolData` for routed and forced searches.
- `web_search_snippets` SSE now includes diagnostics payload.
- Tool audit logging now records diagnostics alongside snippets.

## 4.3 Frontend logging and chat-step visibility

Implemented in `web-ui/index.html`:

- Process log now prints:
  - `Search query: ...`
  - `Providers: tavily=... | google=... | brave=... | ddg=...`
- Chat panel tool-step renderer now shows, per `web_search` step:
  - exact query
  - provider hit/skip/fail summary

This is visible in:
- the turn Process pill,
- current turn process stream,
- and tool execution block under AI messages.

---

## 5) Current End-to-End Flow (Practical)

For a freshness/event question in Agent mode:

1. Router chooses execute (or discuss promotes to execute).
2. `web_search` runs with provider fallback.
3. Each provider attempt is tracked in `search_diagnostics`.
4. Gateway streams:
   - tool call,
   - tool result,
   - snippets,
   - diagnostics.
5. UI shows:
   - exact query,
   - provider statuses,
   - snippets/results.
6. Final answer is synthesized/returned.
7. Grounded claim may be persisted via unified memory policy.

For reactional/chat turns:

1. Conversation/reaction gates classify as discuss.
2. No unnecessary tool call.
3. Normal conversational response path.

---

## 6) What is now materially improved

- Better memory discipline:
  - one policy gate controls long-term writes.
- Better scope isolation:
  - workspace/agent-aware typed facts.
- Better observability:
  - exact web query and provider-level fallback chain is now visible in UI logs.
- Better small-model reliability:
  - deterministic routing and guarded memory persistence reduce drift from `qwen3:4b` format instability.

---

## 7) Recommended next steps (Part 4 candidates)

1. Add `CHAT` vs `COACH/PLAN` discuss sub-modes explicitly (deterministic).
2. Add compact "last-turn context header" for discuss-chat responses to improve continuity.
3. Add hard ban list for kickoff phrases in chat mode unless user asks for planning.
4. Add `/api/facts` viewer panel in UI for memory debug/inspection.
5. Add claim-level evidence IDs in final answers (full evidence contract end-to-end).

---

## 8) Addendum - Latest Pass Implemented

This section captures the newest changes added after the first Part 3 draft.

### 8.1 Cross-mode consistency lock (implemented)

In `src/gateway/server.ts`:

- Added session-level verified facts:
  - `AgentSessionState.verifiedFacts[]`
  - fields: `key`, `value`, `claim_text`, `sources`, `verified_at`, `ttl_minutes`, `confidence`
- Added helpers:
  - `rememberVerifiedFact(...)`
  - `pruneVerifiedFacts(...)`
  - `buildVerifiedFactsHeader(...)`
  - `contradictsVerifiedFacts(...)`
  - `buildConsistencyLockedReply(...)`

Behavior:

- Execute path now stores tool-backed verified claims into `verifiedFacts`.
- Discuss/chat responses are checked for contradictions against these verified claims.
- If contradiction is detected without re-verification, reply is replaced with a consistency-safe anchored response.

This closes the specific failure where:
- execute gives a tool-verified fact,
- then discuss contradicts it using stale model priors.

### 8.2 Always-on lightweight Turn Plan stage (implemented)

In `src/gateway/server.ts`:

- Added `inferTurnPlan(...)` (strict JSON planner):
  - `user_intent`
  - `requires_tools`
  - `tool_candidates`
  - `standalone_request`
  - `missing_info`
  - `confidence`

Behavior:

- Runs at start of agent turns.

### 8.9 Unified routing wrapper + policy precedence (implemented)

In `src/gateway/server.ts`:

- Added `runTurnPipeline(...)` as a single ordered routing wrapper:
  - normalize request
  - apply deterministic domain policy
  - run turn-plan only when policy is not locked
  - compute final route intent/kind/freshness flags
- `/api/chat` now consumes this wrapper instead of scattered route setup.

Policy precedence now enforced:

1. deterministic policy lock
2. turn plan (if unlocked)
3. legacy heuristics as fallback only

This removes route randomness where turn plan/regex could conflict.

### 8.10 Central query path + provenance logging (implemented)

In `src/gateway/server.ts`:

- Expanded centralized query assembly via `buildSearchQuery(...)`.
- Swept remaining fallback/forced query builders (including tenure/date flows) to use this path.
- Added query provenance metadata on route decisions:
  - `policy_template | referent_rewrite | user_direct | fallback_repair`
- Route diagnostics now log:
  - `final_query`
  - `domain`
  - `expected_country`
  - `expected_entity_class`
  - `provenance`
  - `locked_by_policy`

This made web-search behavior fully auditable from logs.

### 8.11 Domain policy table + must-verify expansion (implemented)

In `src/gateway/server.ts`:

- Introduced declarative `DOMAIN_POLICIES` for:
  - `office_holder`
  - `weather`
  - `breaking_news`
  - `market_price`
  - `event_date_fact`
- Each policy now defines:
  - must-verify behavior
  - expected entity class/keywords
  - query template builder

This replaced scattered per-domain decisions and aligned small-model behavior.

### 8.12 Reactor Step B (server-driven executor mode) (implemented)

In `src/agents/reactor.ts` + `src/gateway/server.ts`:

- Added `allowHeuristicRouting` option to reactor.
- Server now runs reactor with `allowHeuristicRouting: false` in main execute path.
- Reactor remains tool executor/loop engine, but route decisions come from server policy/pipeline.

This closes remaining bypass paths where reactor could self-route against policy.

### 8.13 Contradiction tiering in synthesis/execute output (implemented)

In `src/gateway/server.ts`:

- Tiered contradiction handler already used in discuss/chat now also runs after synthesis.
- Tier behavior:
  - Tier 1: rewrite/consistency-locked reply
  - Tier 2 (must-verify domains): one auto re-verify pass via web search

This improved cross-mode consistency for both conversational and execute final responses.

### 8.14 Office-holder deterministic extractor (implemented)

In `src/gateway/server.ts`:

- Added trust-ranked extractor for office-holder queries:
  - strong preference for `whitehouse.gov/administration/*`
  - then other `.gov`
  - archives/low-trust sources deprioritized
- Added deterministic VP/name extraction from:
  - title/snippet patterns
  - administration URL slug fallback (e.g. `/administration/jd-vance/`)
- Inserted this extractor before generic “cannot verify from snippets” fallback.

Impact:

- Prevents false “cannot verify” responses when a high-trust official source is already present in results.

### 8.15 Search Rigor setting (Fast / Verified / Strict) (implemented)

Backend (`src/gateway/server.ts`):

- Added `search_rigor` in `/api/settings/search` GET/POST.
- Added runtime rigor config:
  - `fast`: no sanity retry
  - `verified`: one sanity retry
  - `strict`: one sanity retry + stronger official-source requirement for office-holder extraction

Frontend (`web-ui/index.html`):

- Added Search Rigor selector in Settings -> Search.
- Added quick popover control in chat input panel for:
  - Web Search Rigor: `Fast | Verified | Strict`
  - Thinking Effort: `Standard | Extended` (UI preference)

### 8.16 Chat input control placement/popup fixes (implemented)

In `web-ui/index.html`:

- Moved quick mode control to the Mode row (right-aligned) to preserve input/send layout.
- Fixed popover visibility behavior:
  - default opens upward
  - flips/clamps when needed to stay on-screen

### 8.17 Regression tests expanded (implemented)

In `tests/golden-routing.ts`:

- Added/validated tests for:
  - policy lock precedence over turn plan
  - office-holder sanity retry query rewrite
  - contradiction tier mapping
  - mixed-result office-holder extraction (White House result wins)
- Existing VP/weather/reaction tests remain green.

### 8.18 Validation status

- `npm run build` passes.
- `npm test` passes (`golden-routing: all checks passed`).
- If confidence is sufficient, routing/classification uses `standalone_request` (`routingMessage`) rather than raw user text.
- This improves context carryover for small models without making routing fully model-fragile.

### 8.3 Routing and discuss behavior refinements (implemented)

- `classifyTurnKind(...)` no longer forces execute for all questions.
- Hypothetical prompts (e.g., “if it was real...”) default to discuss unless user asks for sources/citations.
- Tenure/date helper now uses rewritten routing message when available.

### 8.4 Verified context injection widened (implemented)

- Verified-fact header is now included in:
  - discuss-chat prompt
  - discuss-coach prompt
  - synthesis system extras
  - plain chat system extras

This improves continuity and reduces cross-mode factual drift.

### 8.5 Build status

- TypeScript build passes:
  - `npm run build`

### 8.19 Chat UX: queued prompts + preflight status (implemented)

Frontend (`web-ui/index.html`):

- Added queued prompt support while a turn is in progress:
  - user can press Send/Enter during generation to queue the next prompt
  - queued prompts auto-run sequentially after the current turn completes
  - hard queue cap added (`MAX_QUEUED_PROMPTS = 8`)
- Added visible queued-prompts panel above the composer:
  - shows queued items
  - per-item remove
  - clear-all action
- Added in-chat preflight status line above thinking dots:
  - displays runtime-owned status like:
    - "Searching the web for the latest market data..."
    - "Checking official sources for the current office holder..."

Backend (`src/gateway/server.ts`):

- Added `buildPreflightStatusMessage(action, domain)` and emitted `ui_preflight` SSE events before tool calls across execute paths (policy-locked, promotion, NL router, forced freshness, reactor forwarded steps).

### 8.20 Routing hardening for follow-up freshness/tool directives (implemented)

In `src/gateway/server.ts`:

- Expanded `isLikelyToolDirective(...)` to catch additional natural phrasing:
  - "search the web"
  - "web search"
  - "figure it out"
  - "check online/check the web"
- Added market follow-up carryover logic:
  - short follow-ups like "how about silver?" can inherit market-price context and route to execute
  - uses recent verified facts and recent turn hints
- Extended deterministic execute promotion checks:
  - `needsDeterministicExecute(...)` now supports session-aware market follow-up promotion.

### 8.21 Market price extraction robustness (implemented)

In `src/tools/web.ts`:

- Hardened direct price extraction to avoid stale/historical snippet traps:
  - detects historical cues (e.g. "around 1995", "was worth")
  - detects unit context (`per gram` vs `per ounce`)
  - normalizes gram quotes to ounce-equivalent
  - asset-specific plausibility bounds (silver/gold/bitcoin/generic)
  - freshness-weighted candidate scoring
- Enforced minimum result breadth for price queries:
  - `max_results` is now forced to at least 5 for price lookups
  - prevents single low-quality snippet outcomes.

### 8.22 Retrieval budget policy for small models (implemented)

Backend policy (`src/gateway/server.ts`):

- Added `agent_policy.retrieval_mode` with values:
  - `fast`
  - `standard`
  - `deep`
- Wired through `/api/settings/agent` GET/POST.

File tool enforcement (`src/tools/files.ts`):

- `read` tool now supports windowed reads:
  - optional `start_line`
  - optional `num_lines`
- Hard caps by retrieval mode:
  - fast: 120 lines
  - standard: 240 lines
  - deep: 480 lines
- Read responses now include window metadata:
  - `retrieval_mode`
  - `start_line`, `end_line`
  - `returned_lines`, `max_lines_cap`
  - `truncated`

UI (`web-ui/index.html`):

- Added "Code Retrieval Mode" selector under Settings -> Agent Policy and persisted via existing settings APIs.

### 8.23 Validation status for this wave

- `npm run build` passes after each change set in this section.
