# LocalClaw v2: Simplification Roadmap

## The Goal
Rewrite the execute path from 10,400 lines across 255 functions down to ~800-1000 lines across ~20 functions, while keeping the web UI working. The key change: **one LLM call per action** instead of three (discuss → execute → finalize).

---

## What We Keep (don't touch)
- `web-ui/index.html` — works fine, just needs the same SSE events
- `src/agents/ollama-client.ts` — clean, works
- `src/agents/reactor.ts` — the `node_call<>` parser + sandbox are solid, but the execute loop needs rewriting
- `src/config/`, `src/db/`, `src/cli/index.ts` — infrastructure, works
- `package.json`, `tsconfig.json` — no changes needed

## What We Gut
- `src/gateway/server.ts` — 10,472 lines → ~600 lines
- `src/gateway/orchestrator.ts` — absorbed into new server
- `src/gateway/fact-store.ts` — remove (overkill for 4B model)
- `src/gateway/memory-manager.ts` — simplify to basic history
- `src/agents/executor.ts`, `manager.ts`, `verifier.ts` — remove (multi-agent is dead weight for 4B)

---

## Phase 1: New Server Core (the big one)

### Create `src/gateway/server-v2.ts` (~600 lines)

This replaces the 10,472-line server.ts. Structure:

```
Part 1: Imports + Config (~30 lines)
Part 2: Session State (~40 lines) 
Part 3: System Prompt Builder (~30 lines)
Part 4: Single-Pass Agent Handler (~200 lines) ← THE CORE
Part 5: SSE Helpers (~50 lines)
Part 6: HTTP Routes (~100 lines)
Part 7: Express Setup + WS (~50 lines)
```

#### Part 4 Detail: Single-Pass Agent Handler

This is the entire brain. One function, ~200 lines:

```typescript
async function handleChat(message: string, history: ChatMessage[], sessionState: SessionState) {
  // 1. Build prompt (system + history + user message)
  const systemPrompt = buildSystemPrompt(sessionState);  // ~20 lines of rules
  const messages = buildMessages(history, message);
  
  // 2. ONE LLM call with think=true
  const { response, thinking } = await ollama.generateWithRetryThinking(prompt, 'executor', {
    temperature: 0.3,
    num_ctx: 4096,
    num_predict: 512,  // thinking is separate, this is all for code/response
    think: true,
  });
  
  // 3. Parse response for node_call<> blocks
  const nodeCalls = extractNodeCallBlocks(response);
  
  // 4a. If no node_calls → it's a chat response, return it
  if (nodeCalls.length === 0) {
    return { type: 'chat', text: response };
  }
  
  // 4b. Execute each node_call in sandbox
  const results = [];
  for (const code of nodeCalls) {
    const isDestructive = DESTRUCTIVE_RE.test(code);
    const result = await runNodeCallSandbox(code, ...);
    results.push({ code, result, isDestructive });
    // Stream SSE events as we go
  }
  
  // 5. Extract FINAL: from response (after node_calls)
  const finalMatch = response.match(/FINAL:\s*([\s\S]*?)$/i);
  const finalText = finalMatch?.[1]?.trim();
  
  // 6. If no FINAL in response, do ONE short follow-up call
  if (!finalText && results.length > 0) {
    const summary = await summarizeResults(message, results);
    return { type: 'execute', text: summary, results };
  }
  
  return { type: 'execute', text: finalText, results };
}
```

**That's it.** No discuss mode. No execute mode. No finalize. No continuation loop. No open_tool signals. No mode switching. The model decides in one pass whether to write code or chat.

#### The System Prompt (~20 lines)

```
You are LocalClaw, a local AI assistant with file system access.

To perform actions, write: node_call<your javascript code>
After code executes, write: FINAL: <what happened>
To just chat without actions, respond normally.

WORKSPACE = {path}
Available: fs, path, child_process (via require). WORKSPACE is pre-injected.

Examples:
  node_call<const fs=require('fs'); return fs.readdirSync(WORKSPACE);>
  node_call<const fs=require('fs'); return fs.readdirSync(WORKSPACE).filter(f=>f.startsWith('golden')).length;>
  node_call<const fs=require('fs'),p=require('path'); fs.readdirSync(WORKSPACE).filter(f=>f.startsWith('golden')).forEach(f=>fs.unlinkSync(p.join(WORKSPACE,f))); // DESTRUCTIVE>

Rules:
- Write node_call blocks immediately, no prose before them.
- For delete/rename/overwrite: add // DESTRUCTIVE comment in code.
- If unsure what to delete, list files first, then delete in a second node_call.
- Keep code compact. Prefer chaining over extra variables.
- Always write FINAL: after node_call results come back.
```

### SSE Events to Keep (UI compatibility)

The web UI listens for these. We keep them but simplify:

| Event | When | Data |
|-------|------|------|
| `info` | Status updates | `{ message }` |
| `thinking` | Model is thinking | `{ text }` |
| `tool_call` | node_call detected | `{ code, isDestructive }` |
| `tool_result` | Sandbox result | `{ result, error }` |
| `step` | Step progress | `{ step, total }` |
| `final` | Final response | `{ text }` |
| `done` | Turn complete | `{ sections }` |
| `heartbeat` | Keepalive | `{ state }` |
| `error` | Failure | `{ message }` |

Drop: `agent_mode`, `session_mode_locked`, `turn_execution_created`, `turn_execution_updated`, `ui_preflight`, `decomposed`, `synth_*`, `memory_*`, `web_search_snippets`

### HTTP Routes to Keep

| Route | Purpose |
|-------|---------|
| `POST /api/chat` | Main chat endpoint (SSE) |
| `GET /api/status` | Health check |
| `GET /api/open-path` | Open file in OS |

Drop: `/api/jobs`, `/api/skills/*`, `/api/settings/*`, `/api/system-stats`, `/api/memory/*`, `/api/approvals`

---

## Phase 2: Slim Reactor (~400 lines)

### Rewrite `src/agents/reactor.ts`

Keep:
- `extractNodeCallBlocks()` — the parser (already solid)
- `runNodeCallSandbox()` — the sandbox (already solid)
- `isDestructiveNodeCall()` — detection
- `DESTRUCTIVE_NODE_RE` — the regex

Remove:
- `buildNodeCallSystemPrompt()` — replaced by 20-line prompt in server-v2
- `buildNativeToolSystemPrompt()` — never used well
- The entire execute loop (`while stepCount < maxSteps`) — replaced by single-pass
- Format violation handling — not needed with single pass
- Circuit breakers, repeat detection — not needed
- Thinking extraction/merging — ollama-client handles this

New export surface:
```typescript
export { extractNodeCallBlocks, runNodeCallSandbox, isDestructiveNodeCall };
```

That's it. The reactor becomes a utility module, not an engine.

---

## Phase 3: Simple Session State

### Create `src/gateway/session.ts` (~100 lines)

```typescript
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface Session {
  id: string;
  history: ChatMessage[];  // last N messages
  workspace: string;
}

// Store in memory, persist to JSON file
const sessions = new Map<string, Session>();

export function getSession(id: string): Session;
export function addMessage(id: string, msg: ChatMessage): void;
export function getHistory(id: string, maxTurns?: number): ChatMessage[];
```

No plans. No verified facts. No workspace ledger. No self-learning. No execution tracking. Just messages.

---

## Phase 4: Web UI Compatibility Layer

The web UI mostly works already. Changes needed:

1. Simplify the process/timeline view — it currently expects `turn_execution_*` events for the elaborate step tracking. With single-pass, we just send `thinking` → `tool_call` → `tool_result` → `final` → `done`.

2. The "Process" accordion in the UI should still work since it handles `think`, `tool_call`, `tool_result`, `final` events individually.

3. Drop the mode indicator (Agent/Discuss/Execute) — there's only one mode now.

---

## Implementation Order

### Step 1: Create `server-v2.ts` alongside existing `server.ts`
- Don't delete anything yet
- New file, fresh start
- Wire it to `localclaw gateway start-v2` command
- Test with the golden files scenario

### Step 2: Get "count golden files" working
- Single LLM call → model writes node_call → sandbox runs → FINAL returned
- Target: <30 seconds

### Step 3: Get "remove golden files" working  
- Same single pass — model writes destructive node_call
- No confirmation dance — user said "remove them"
- Target: <30 seconds

### Step 4: Get conversational chat working
- "Hey claw, what's up?" → model responds without node_call
- No mode switching needed

### Step 5: Error recovery
- If node_call has syntax error, feed error back, ONE retry
- If retry fails, return error to user honestly

### Step 6: Polish SSE events for UI
- Make sure process timeline looks clean
- Thinking visible, tool calls visible, results visible

### Step 7: Retire old server.ts
- Once v2 handles all test cases
- Move server.ts to server-legacy.ts
- Make v2 the default

---

## What This Removes

| Feature | Lines | Why Remove |
|---------|-------|-----------|
| Multi-agent (manager/executor/verifier) | ~250 | 4B model can't coordinate agents |
| Plan system (tasks, objectives, signals) | ~600 | Single-pass doesn't need plans |
| Self-learning store | ~200 | Premature optimization |
| Auto-repair skills | ~150 | Never worked reliably |
| Verified facts system | ~200 | 4B model doesn't hallucinate less with this |
| HTML manipulation (color, panel, text) | ~300 | Not core functionality |
| Workspace ledger | ~150 | File listing is instant |
| Evidence-gated replies | ~200 | Cloud API feature |
| Office holder detection | ~100 | Web search feature |
| Temporal contradiction repair | ~50 | Not needed |
| Turn execution tracking | ~400 | Single-pass doesn't have turns |
| Decision metrics/tracing | ~200 | Debug feature, add back later |
| CPU/GPU monitoring | ~200 | Nice-to-have, not core |
| Search decomposition | ~200 | Web search feature |
| Discuss/Execute/Finalize modes | ~2000 | THE CORE SIMPLIFICATION |
| Continuation loops | ~300 | Single-pass doesn't loop |
| Format violation handling | ~200 | Single-pass, one retry |
| **Total removed** | **~5,700** | |

## What This Keeps

| Feature | Lines | Why Keep |
|---------|-------|---------|
| Express + SSE server | ~100 | UI needs it |
| Chat endpoint handler | ~200 | The core |
| System prompt | ~30 | The brain |
| node_call parser | ~50 | Works great |
| Sandbox executor | ~120 | Works great |
| Session/history | ~100 | Conversation context |
| Ollama client | ~338 | Works great |
| **Total kept** | **~938** | |

---

## Expected Performance

| Scenario | Current | Target |
|----------|---------|--------|
| Count files | 33-78s (3 LLM calls) | <25s (1 call) |
| Delete files | FAILS or 67s+ | <30s (1 call) |
| Chat response | 20-30s | <15s (1 call) |
| Error + retry | BLOCKED | <40s (2 calls max) |
