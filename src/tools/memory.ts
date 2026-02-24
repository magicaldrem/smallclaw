import { ToolResult } from '../types.js';
import { loadMemory, updateMemory } from '../config/soul-loader.js';
import { getConfig } from '../config/config.js';

// MEMORY_WRITE: model appends or replaces a bullet in memory.md
export async function executeMemoryWrite(args: { fact: string; action?: 'append' | 'replace_all' | 'upsert'; key?: string; reference?: string; source_tool?: string; source_output?: string; actor?: 'agent' | 'user' | 'system' }): Promise<ToolResult> {
  if (!args.fact?.trim()) return { success: false, error: 'fact is required' };
  const action = args.action ?? 'append';

  try {
    const cfg = getConfig().getConfig();
    const truncateLen = cfg.memory_options?.truncate_length ?? 1000;
    const sanitize = (s: any) => {
      if (s == null) return '';
      let t = typeof s === 'string' ? s : JSON.stringify(s);
      t = t.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
      if (t.length > truncateLen) t = t.slice(0, truncateLen) + '\n...[truncated]';
      return t;
    };

    const fact = sanitize(args.fact.trim());
    const actor = args.actor || 'agent';
    const reference = args.reference ? sanitize(args.reference) : undefined;
    const source_tool = args.source_tool ? sanitize(args.source_tool) : undefined;
    const source_output = args.source_output ? sanitize(args.source_output) : undefined;
    const key = args.key ? sanitize(args.key) : undefined;

    // Build bullet with metadata
    const metaParts: string[] = [];
    metaParts.push(`[${actor}]`);
    if (key) metaParts.push(`[key=${key}]`);
    if (reference) metaParts.push(`[ref=${reference}]`);
    if (source_tool) metaParts.push(`[src=${source_tool}]`);
    const meta = metaParts.join('');
    const bullet = `- ${meta} ${fact}`;

    if (action === 'replace_all') {
      updateMemory(`# Memory\n\n${bullet}\n`);
    } else if (action === 'upsert') {
      const current = loadMemory();
      const lines = current ? current.split(/\r?\n/) : [];
      const hasHeader = lines.some(l => /^#\s*memory\b/i.test(l.trim()));
      const keyPattern = key ? new RegExp(`\\[key=${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`) : null;
      const filtered = lines.filter(line => {
        const t = line.trim();
        if (!t) return true;
        if (/^#\s*memory\b/i.test(t)) return true;
        if (!t.startsWith('-')) return true;
        if (keyPattern && keyPattern.test(t)) return false;
        return true;
      });
      const out = [];
      if (hasHeader) out.push(...filtered);
      else out.push('# Memory', '', ...filtered.filter(l => l.trim() !== '# Memory'));
      if (out.length > 0 && out[out.length - 1].trim() !== '') out.push('');
      out.push(bullet);
      out.push('');
      updateMemory(out.join('\n'));
    } else {
      const current = loadMemory();
      // Remove placeholder line if present
      const cleaned = current.replace(/- First run: no facts stored yet\.|\n?/, '').trim();
      const bullets = cleaned ? `${cleaned}\n${bullet}\n` : `# Memory\n\n${bullet}\n`;
      updateMemory(bullets);
    }

    return { success: true, stdout: `Memory updated: ${fact}` };
  } catch (err: any) {
    return { success: false, error: `Memory write failed: ${err.message}` };
  }
}

export const memoryWriteTool = {
  name: 'memory_write',
  description: 'Persist a fact to long-term memory (survives restarts)',
  execute: executeMemoryWrite,
  schema: {
    fact: 'string (required) - The fact to remember (e.g. "User prefers Python 3.12")',
    action: 'string (optional) - "append" (default) adds a new bullet, "upsert" replaces bullet with same key, "replace_all" clears and rewrites',
    key: 'string (optional) - unique key for upsert (e.g., "fact:us-attorney-general")',
    reference: 'string (optional) - job id or session reference to associate with this fact',
    source_tool: 'string (optional) - tool that produced this fact (e.g., web_search)',
    source_output: 'string (optional) - raw tool output or snippet',
    actor: 'string (optional) - who added the fact: agent|user|system'
  },
};
