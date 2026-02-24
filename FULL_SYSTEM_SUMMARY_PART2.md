# LocalClaw - System Summary (Part 2)

This document captures the second major implementation phase focused on small-LLM reliability, natural tool routing, freshness correctness, and gateway UX/settings hardening.

## 1) Core Reliability Upgrades

- Added typed fact memory store:
  - `src/gateway/fact-store.ts`
  - JSON-backed records with `scope`, `session_id`, `source_tool/source_url`, `verified_at`, `expires_at`, `confidence`.
  - Query support for relevance + stale filtering.
- Upgraded memory manager:
  - `src/gateway/memory-manager.ts`
  - Canonical writes still use `memory_write`, then mirror into typed fact store.
  - Supports scoped writes (`session` vs `global`) + confidence + source metadata.
- Added scoped memory injection into prompts:
  - `buildScopedMemoryInstruction(...)` in `src/gateway/server.ts`
  - Fresh queries prefer fresh facts; stale facts only as fallback.

## 2) Agent Orchestration Improvements

- Session plan model expanded:
  - Overview objective, active objective, turns, task list, notes, pending questions.
  - Better separation between new objective vs side question vs continue plan.
- Added deterministic tenure-days solver:
  - For queries like "how many days has X been in office".
  - Uses web + system time tool path and computes days in backend.
- Added stronger "question in agent mode => execute-capable path" behavior.
- Added provenance carryover:
  - Session stores last tool evidence (`question`, `tools`, `topSources`).
  - Follow-ups like "where did you get that?" now resolve from prior evidence.

## 3) Output/Format Failure Recovery

- Hardened format failure recovery in reactor:
  - On format violations, force fallback mapping early.
  - If mapping is uncertain for question-like prompts, force generic `web_search`.
  - Prevent raw protocol text (`THOUGHT/ACTION/PARAM`) from becoming final user reply.
- Added protocol sanitization:
  - `stripProtocolArtifacts(...)` in `src/gateway/server.ts`
  - Filters leaked tool-format scaffolding from user-facing output.

## 4) Freshness + Anti-Hallucination Guardrails

- Freshness routing expanded beyond finance/politics keywords:
  - Includes model/version/release/event/legal outcome query patterns.
- Added hard freshness gate:
  - If query is freshness-sensitive and no web evidence exists, backend forces a web search before synthesis.
- Added policy controls:
  - `force_web_for_fresh`
  - `memory_fallback_on_search_failure`
  - `auto_store_web_facts`
  - `natural_language_tool_router`
- Added APIs:
  - `GET /api/settings/agent`
  - `POST /api/settings/agent`

## 5) Natural-Language Tool Decoding (Major Feature)

- Added NL router + context resolver:
  - Detects directives like:
    - "use web"
    - "look it up"
    - "verify that"
    - "what does the web say"
  - Resolves `it/that/previous` using recent turns/history/active objective.
- Added discuss->execute promotion:
  - Pre-route promotion: discuss can auto-promote before generating final reply.
  - Post-draft promotion: if discuss draft shows uncertainty/stale cues, same-turn promotion triggers tools.
- Added class-based confidence thresholds:
  - Provenance queries: lower threshold
  - Freshness queries: lower threshold
  - General queries: stricter threshold

## 6) Event/Outcome Query Answering

- Implemented deterministic event-outcome summarizer:
  - For "what happened / outcome / takeaways" style prompts.
  - Parses top search snippets, extracts key points, returns concise bullet summary + sources.
  - Runs before weak fallback branches that only return links.
- Upgraded `web_search` with a small-model-friendly evidence pipeline:
  - Rule-based event query detection.
  - Low-value source rejection (e.g., opinion/podcast/youtube/reddit/substack bias).
  - Relevance gating using anchor terms + event terms.
  - Fetch + clean article text (best effort) for top results.
  - Evidence sentence extraction with action-verb/entity scoring.
  - Deduped claim selection and source-cited deterministic answer string:
    - `Answer: <claims with [source]> Sources: [1] ... [2] ...`
  - This reduces reliance on long LLM synthesis for event/news prompts.

## 7) UI/Gateway Improvements

- Sessions UX:
  - Jobs -> Sessions model behavior.
  - Added session edit/delete controls.
- Process UX:
  - Process traces preserved and shown per turn.
  - Thinking/events streamed and persisted in chat process blocks.
- Right panel converted to agent context (objectives/tasks/turns).
- Settings UI redesigned into tabs:
  - System
  - Search
  - Agent Policy
  - Security
- Settings now support on-the-fly policy + provider/path changes.

## 8) Search Stack Hardening

- Multi-provider support retained (Tavily/Google/Brave/DDG + fallback ordering).
- Provider output trust hardening:
  - Reduced trust in provider "answer" shortcuts for freshness queries.
  - Ranking by domain trust + relevance.
  - Low-quality Google share-link rejection and provider fallback.

## 9) Small-LLM Behavior Tuning

- Reduced rumination loops:
  - Default think level moved toward `low` in key paths.
  - Reactor prompt constraints now discourage "but wait" self-debate loops.
- Kept strict formatting + retries but with deterministic recovery to avoid stalls.

## 10) Current Known Direction (Next)

- Add supervisor-style failure taxonomy (format/synthesis/freshness/provenance mismatch) with explicit recovery actions.
- Add `systemPromptReport` telemetry in LocalClaw (OpenClaw-like visibility) for prompt composition debugging.
- Add inspectable facts endpoint/UI (`/api/facts`) to debug memory bleed and stale entries quickly.

---

If you want, next step is to merge this into `FULL_SYSTEM_SUMMARY.md` and keep this file as a changelog appendix.
