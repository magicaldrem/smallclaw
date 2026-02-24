import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getToolRegistry } from '../tools/registry';
import { getDatabase } from '../db/database';
import { getConfig } from '../config/config';
import {
  defaultExpiryHoursForKey,
  upsertFactRecord,
  FactScope,
  FactType,
  FactSourceKind,
} from './fact-store';

const registry = getToolRegistry();
const db = getDatabase();
const cfg = getConfig().getConfig();

export interface MemoryClaim {
  claim: string;
  type: FactType;
  scope: FactScope;
  workspace_id: string;
  agent_id: string;
  session_id?: string;
  source_kind: FactSourceKind;
  source_ref: string;
  confidence: number;
  ttl_hours?: number;
}

type MemoryDecision = 'DISCARD' | 'DAILY_NOTE' | 'TYPED_FACT' | 'CURATED_PROFILE';

function sanitizeText(input: any): string {
  const truncateLen = cfg.memory_options?.truncate_length ?? 1000;
  if (input == null) return '';
  let t = typeof input === 'string' ? input : JSON.stringify(input);
  t = t.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  if (t.length > truncateLen) t = t.slice(0, truncateLen) + '\n...[truncated]';
  return t.trim();
}

function shouldDiscardClaim(claim: MemoryClaim): boolean {
  const text = sanitizeText(claim.claim);
  if (!text || text.length < 10) return true;
  if (/^error|^max steps|^thought:/i.test(text)) return true;
  if (/\bcould not produce\b|\bformat violation\b|\bunsupported_mutation\b|\bmissing_required_input\b/i.test(text)) return true;
  if (/^\s*blocked\b/i.test(text)) return true;
  return false;
}

export function decideMemoryWrite(claim: MemoryClaim): MemoryDecision {
  if (shouldDiscardClaim(claim)) return 'DISCARD';
  if (!claim.source_kind || !claim.source_ref) return 'DAILY_NOTE';
  if ((claim.type === 'preference' || claim.type === 'rule') && claim.scope === 'global' && claim.confidence >= 0.9) {
    return 'CURATED_PROFILE';
  }
  if (claim.confidence >= 0.55) return 'TYPED_FACT';
  return 'DAILY_NOTE';
}

function getDailyMemoryPath(): string {
  const day = new Date().toISOString().slice(0, 10);
  return path.join(cfg.workspace.path, 'memory', `${day}.md`);
}

export function appendDailyMemoryNote(line: string): void {
  const p = getDailyMemoryPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const ts = new Date().toISOString();
  fs.appendFileSync(p, `- [${ts}] ${sanitizeText(line)}\n`, 'utf-8');
}

function normalizeFactKeyFromClaim(claim: MemoryClaim): string {
  const lhs = sanitizeText(claim.claim).match(/^(.+?)\s+(is|are|was|were)\s+/i)?.[1]?.trim();
  const base = lhs || sanitizeText(claim.claim);
  const slug = base.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim().replace(/\s+/g, '-').slice(0, 80) || 'item';
  return `fact:${slug}`;
}

export async function persistMemoryClaim(claim: MemoryClaim): Promise<{ success: boolean; destination: MemoryDecision; message?: string }> {
  const decision = decideMemoryWrite(claim);
  if (decision === 'DISCARD') return { success: true, destination: decision, message: 'discarded' };

  if (decision === 'DAILY_NOTE') {
    appendDailyMemoryNote(claim.claim);
    return { success: true, destination: decision, message: 'daily note appended' };
  }

  if (decision === 'CURATED_PROFILE') {
    const key = `profile:${normalizeFactKeyFromClaim(claim).replace(/^fact:/, '')}`;
    const res = await addMemoryFact({
      fact: claim.claim,
      key,
      action: 'upsert',
      scope: 'global',
      workspace_id: claim.workspace_id,
      agent_id: claim.agent_id,
      session_id: claim.session_id,
      source_kind: claim.source_kind,
      source_ref: claim.source_ref,
      source_tool: claim.source_kind === 'tool' || claim.source_kind === 'web' ? 'web_search' : undefined,
      confidence: claim.confidence,
      actor: 'agent',
      type: claim.type,
    });
    return { success: !!res.success, destination: decision, message: res.message };
  }

  const factKey = normalizeFactKeyFromClaim(claim);
  const ttlHours = typeof claim.ttl_hours === 'number' ? claim.ttl_hours : defaultExpiryHoursForKey(factKey);
  const nowIso = new Date().toISOString();
  const expires_at = ttlHours ? new Date(Date.now() + ttlHours * 3600_000).toISOString() : undefined;
  upsertFactRecord({
    key: factKey,
    value: sanitizeText(claim.claim),
    type: claim.type,
    scope: claim.scope,
    workspace_id: claim.workspace_id,
    agent_id: claim.agent_id,
    session_id: claim.session_id,
    source_kind: claim.source_kind,
    source_ref: claim.source_ref,
    source_tool: claim.source_kind === 'tool' || claim.source_kind === 'web' ? 'web_search' : undefined,
    verified_at: nowIso,
    expires_at,
    confidence: claim.confidence,
    actor: 'agent',
  });
  appendDailyMemoryNote(claim.claim);
  return { success: true, destination: decision, message: 'typed fact upserted' };
}

export async function addMemoryFact(args: {
  fact: string;
  key?: string;
  action?: 'append' | 'upsert' | 'replace_all';
  scope?: FactScope;
  session_id?: string;
  confidence?: number;
  source_url?: string;
  reference?: string;
  source_kind?: FactSourceKind;
  source_ref?: string;
  source_tool?: string;
  source_output?: any;
  actor?: 'agent' | 'user' | 'system';
  type?: FactType;
  workspace_id?: string;
  agent_id?: string;
}): Promise<{ success: boolean; message?: string }> {
  const { fact, key, action, scope, session_id, confidence, source_url, reference, source_kind, source_ref, source_tool, source_output, actor, type, workspace_id, agent_id } = args;
  const safeFact = sanitizeText(fact);
  const safeSourceOutput = source_output ? sanitizeText(source_output) : undefined;
  const discardProbe: MemoryClaim = {
    claim: safeFact,
    type: type || 'generic_fact',
    scope: scope || 'global',
    workspace_id: workspace_id || '',
    agent_id: agent_id || '',
    session_id,
    source_kind: source_kind || 'system',
    source_ref: source_ref || 'addMemoryFact',
    confidence: typeof confidence === 'number' ? confidence : 0.5,
  };
  if (shouldDiscardClaim(discardProbe)) {
    return { success: true, message: 'discarded' };
  }
  const shouldForceSessionScopeForTemporalClaim =
    /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(safeFact)
    || /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i.test(safeFact)
    || /\b\d{1,2}:\d{2}\b/.test(safeFact)
    || /\blocal time\b/i.test(safeFact)
    || /\bcurrent time\b/i.test(safeFact);
  const normalizedScope: FactScope = shouldForceSessionScopeForTemporalClaim ? 'session' : (scope || 'global');

  try {
    const tool = registry.get('memory_write');
    if (!tool) throw new Error('memory_write tool not registered');
    const toolResult = await tool.execute({ fact: safeFact, key, action: action || 'append' });

    try {
      if (cfg.memory_options?.audit ?? true) {
        db.createMemoryLog({
          id: randomUUID(),
          reference: reference,
          fact: safeFact,
          source_tool: source_tool,
          source_output: safeSourceOutput,
          actor: actor || 'agent',
          success: toolResult.success ? 1 : 0,
          error: toolResult.success ? undefined : (toolResult.error || 'unknown'),
        });
      }
    } catch (dbErr: any) {
      console.error('[memory-manager] Failed to persist memory log:', dbErr?.message || dbErr);
    }

    if (!toolResult.success) return { success: false, message: toolResult.error || 'Memory write tool failed' };

    try {
      const nowIso = new Date().toISOString();
      const factKey = key || `fact:${safeFact.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim().replace(/\s+/g, '-').slice(0, 80) || 'item'}`;
      const ttlHours = defaultExpiryHoursForKey(factKey);
      const expires_at = ttlHours ? new Date(Date.now() + ttlHours * 3600_000).toISOString() : undefined;
      upsertFactRecord({
        key: factKey,
        value: safeFact,
        type,
        scope: normalizedScope,
        workspace_id,
        agent_id,
        session_id,
        source_kind,
        source_ref,
        source_tool,
        source_url,
        verified_at: nowIso,
        expires_at,
        confidence: typeof confidence === 'number' ? confidence : undefined,
        actor: actor || 'agent',
      });
    } catch (storeErr: any) {
      console.error('[memory-manager] Typed fact store upsert failed:', storeErr?.message || storeErr);
    }

    return { success: true, message: toolResult.stdout || 'Memory updated' };
  } catch (err: any) {
    console.error('[memory-manager] Error adding memory fact:', err?.message || err);
    return { success: false, message: err?.message || String(err) };
  }
}
