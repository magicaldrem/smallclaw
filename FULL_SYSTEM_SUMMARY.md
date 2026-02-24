# LocalClaw Full System Summary

Last updated: 2026-02-18

## 1. Project Goal

LocalClaw is an OpenClaw-style local agent framework optimized for small local models (e.g., `qwen3:4b` via Ollama).  
The primary design goal is to keep tool power (shell/files/web/etc.) while adding deterministic guardrails so small models behave reliably.

---

## 2. Current Architecture (High-Level)

### Runtime layers

1. `web-ui/index.html`
- Browser UI (single-file app): chat UX, sessions, process log, skills, settings modal.

2. `src/gateway/server.ts`
- Main API gateway (Express + WebSocket + SSE chat streaming).
- Handles `/api/chat`, settings APIs, jobs, approvals, skills endpoints.

3. `src/agents/reactor.ts`
- ReAct tool loop with strict output protocol (`THOUGHT/ACTION/PARAM` or `FINAL`).
- Includes parser fallback + deterministic tool mapping for small-model resilience.

4. `src/tools/*`
- Tool implementations and registry (web search/fetch, file tools, shell, memory, etc.).

5. `src/agents/*` (planner/executor/verifier + Ollama client)
- Structured multi-agent components and orchestration.

6. `src/db/database.ts`
- SQLite persistence for jobs/tasks/steps/artifacts/approvals + memory/synthesis logs.

---

## 3. Major Capability Changes Implemented

## 3.1 Agent Mode is now conversational + staged (Discuss/Plan/Execute)

Implemented in `src/gateway/server.ts`:

- Added session-scoped agent state:
  - `objective`, `summary`, `tasks`, `notes`, `pendingQuestions`, `mode`.
- Added intent router:
  - `discuss` (normal conversation, no tools)
  - `plan` (plan-building conversation, no tools)
  - `execute` (tool-enabled execution)
- Added mode inference from natural language (not only exact trigger phrase).
- Added execution context injection:
  - execution calls use compact persisted plan context, reducing raw history/token load.
- Emits SSE event `agent_mode` so UI shows current submode.

Effect:
- In agent mode, not every message fires tools anymore.
- User can discuss/plan naturally and later say variants of “go ahead/run/start/continue” to execute.

---

## 3.2 Web search and freshness hardening for small models

Implemented across `src/agents/reactor.ts`, `src/tools/web.ts`, and `src/gateway/server.ts`:

- Deterministic pre-routing for high-confidence queries (price/time/current-office-holder).
- Strict freshness gates:
  - freshness/factual questions cannot finalize from model priors alone.
  - for required-freshness questions, web search is forced before finalization.
- Format-violation recovery:
  - repeated parser failures now trigger deterministic fallback tool mapping instead of empty output.
- Fast path for tool answers:
  - if tool result starts with `Answer: ...`, reactor finalizes immediately.
- Added raw-output diagnostics on format violations.

Effect:
- Reduced hallucination risk for “current” questions.
- Improved recovery when small model format adherence fails.

---

## 3.3 Search provider control and quality improvements

Implemented in `src/tools/web.ts` + `.localclaw/config.json`:

- Added provider preference config:
  - `search.preferred_provider` = `tavily | google | brave | ddg`.
- Switched active preference to Tavily-first in local config.
- Search orchestration now uses provider order with fallback.
- Added Google URL normalization and low-quality Google CSE-result rejection.

Effect:
- Better agent-friendly search defaults with Tavily.
- Cleaner fallback behavior when Google CSE quality is poor.

---

## 3.4 UI modernization and workflow shift to chat-first

Implemented in `web-ui/index.html`:

- Complete visual refresh to modern, cleaner professional style.
- Removed mission tab/panel from primary UX.
- Left panel converted from “Jobs” to “Sessions”.
- New chat threads:
  - `+ New Chat`
  - local session persistence via `localStorage`
  - per-session message history and title.
- Quick actions now include settings button.

Effect:
- Claude/GPT-like session UX.
- No need to clear chat manually; create/open sessions naturally.

---

## 3.5 Settings in UI (live configuration)

Implemented in UI + backend:

Backend (`src/gateway/server.ts`):
- Existing:
  - `GET/POST /api/settings/paths`
- Added:
  - `GET /api/settings/search`
  - `POST /api/settings/search`

UI (`web-ui/index.html`):
- Added settings modal with editable:
  - allowed paths
  - blocked paths
  - preferred web provider
  - Tavily/Google/Google CSE/Brave keys
- Save writes both paths and search settings via API.

Effect:
- Runtime tuning/config from UI without manual file edits.

---

## 4. Key Files Changed

1. `src/gateway/server.ts`
- Agent session state + mode router + plan/execution context helpers.
- Settings APIs for search provider/keys.
- SSE `agent_mode` support and existing chat pipeline enhancements.

2. `src/agents/reactor.ts`
- Deterministic intent mapping fallback.
- Pre-route heuristics.
- Freshness gates and forced web-search when needed.
- Direct `Answer:` fast finalization.

3. `src/tools/web.ts`
- Provider preference orchestration.
- Tavily-first support and fallback order.
- Google result normalization + low-quality guard.
- Price-answer extraction helpers.

4. `web-ui/index.html`
- Full CSS/UX refresh.
- Sessions system (client-side persisted chat threads).
- Settings modal + API integration.
- Agent mode telemetry display in process log.

5. `.localclaw/config.json`
- Added/used `search.preferred_provider` (currently set to `tavily`).

---

## 5. Current UX Behavior at a Glance

### Chat flow

1. User opens/creates a session (left panel).
2. User sends message from chat input.
3. If agent toggle OFF:
- plain conversational model response.

4. If agent toggle ON:
- backend infers `discuss/plan/execute`.
- Discuss/Plan: conversational response, no tools.
- Execute: tool loop with reliability guards + verification/synthesis pipeline.

### Process log

- Streams user/tool/result/final entries.
- Shows inferred `Agent mode: discuss|plan|execute`.

### Settings

- Can update path restrictions + search provider/API keys from modal.

---

## 6. What Is Still Partial / Not Yet Unified

1. Legacy mission/job JS still exists in `web-ui/index.html` (not primary UX path now).
- Safe to keep short-term; should be cleaned for maintainability.

2. Agent session state persistence is currently in-memory server map.
- Survives within process lifetime, but not full daemon restarts.
- Next step: persist session state in DB.

3. Evidence extraction for factual queries is improved but not yet a full typed evidence graph.
- Next step: formal claim/evidence verifier before final answer synthesis.

4. Chat/agent toggle still exists by choice (as requested).
- Intended later path: unify into a single smart mode once behavior is stable.

---

## 7. Recommended Next Implementation Phases

1. Session state persistence (DB-backed)
- Add `chat_sessions` + `chat_messages` tables.
- Persist `AgentSessionState`.

2. Remove dead mission-only UI code
- Keep backend mission APIs if desired, but simplify frontend.

3. Add explicit evidence contract for freshness claims
- `claim -> evidence[] -> confidence` before final response.

4. Introduce policy config profile for small models
- `strict|balanced|creative` tool-routing + verification profile.

5. Unify chat/agent toggle into one adaptive mode
- after reliable intent + evidence gating metrics confirm stability.

---

## 8. Summary

LocalClaw has moved from a tool-trigger-heavy prototype toward a chat-first, session-based, policy-driven assistant that is more suitable for small local models.  
Core reliability improvements are in place (intent routing, fallback mapping, freshness guards, configurable provider priority), and the UI now supports practical day-to-day use with sessions and live settings.

