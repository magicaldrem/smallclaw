/**
 * cron-scheduler.ts — LocalClaw Tasks / Cron System
 *
 * Design constraints (4B model reality):
 *  - isModelBusy guard: if a user chat is in-flight, skip the tick entirely
 *  - One task at a time, no parallelism
 *  - Minimal cron parsing — handles the 90% patterns without external deps
 *  - HEARTBEAT_OK response is silently suppressed
 *  - Any real content → creates an automated chat session broadcast over WS
 *  - Telegram stub: deliverTelegram() is a no-op with a clear TODO marker
 */

import fs from 'fs';
import path from 'path';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface CronJob {
  id: string;
  name: string;
  prompt: string;
  type: 'one-shot' | 'recurring' | 'heartbeat';
  schedule: string | null;   // 5-field cron expression, e.g. "*/30 * * * *"
  runAt: string | null;      // ISO timestamp for one-shots
  enabled: boolean;
  priority: number;          // lower number = higher priority
  delivery: 'web';           // 'telegram' coming later — stub is ready
  lastRun: string | null;
  lastResult: string | null;
  lastDuration: number | null;
  nextRun: string | null;
  status: 'scheduled' | 'queued' | 'running' | 'completed' | 'paused';
  sessionId: string | null;  // auto-created session for completed output
  createdAt: string;
}

export interface HeartbeatConfig {
  enabled: boolean;
  intervalMinutes: number;
  activeHoursStart: number; // 0–23
  activeHoursEnd: number;   // 0–23
}

export interface CronStore {
  heartbeat: HeartbeatConfig;
  jobs: CronJob[];
}

export interface AutomatedSession {
  id: string;
  title: string;
  jobName: string;
  jobId: string;
  history: Array<{ role: string; content: string }>;
  automated: true;
  createdAt: number;
}

// ─── Minimal Cron Parser ───────────────────────────────────────────────────────
// Supports: * * * * * (min hour dom month dow)
// Patterns covered:
//   */N  * * * *   → every N minutes
//   0    H * * *   → daily at hour H
//   0    H * * D   → weekly on day D at H
//   0    H 1 * *   → monthly on 1st at H
//   *    * * * *   → every minute (should not be used but handled)

function parseField(field: string, min: number, max: number): number[] {
  const results: number[] = [];
  if (field === '*') {
    for (let i = min; i <= max; i++) results.push(i);
    return results;
  }
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    if (isNaN(step) || step <= 0) return results;
    for (let i = min; i <= max; i += step) results.push(i);
    return results;
  }
  // comma-separated list
  for (const part of field.split(',')) {
    const n = parseInt(part.trim(), 10);
    if (!isNaN(n) && n >= min && n <= max) results.push(n);
  }
  return results;
}

export function getNextRun(cronExpr: string | null, from: Date): Date {
  if (!cronExpr) {
    // Default: 30 minutes from now
    return new Date(from.getTime() + 30 * 60 * 1000);
  }

  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) {
    // Fallback: every 30 minutes
    return new Date(from.getTime() + 30 * 60 * 1000);
  }

  const [minuteField, hourField, domField, , dowField] = parts;
  const minutes = parseField(minuteField, 0, 59);
  const hours = parseField(hourField, 0, 23);
  const doms = parseField(domField, 1, 31);
  const dows = parseField(dowField, 0, 6);

  // Iterate forward minute by minute (max 1 week)
  const candidate = new Date(from);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1); // must be in the future

  const maxMs = 7 * 24 * 60 * 60 * 1000;
  const limit = new Date(from.getTime() + maxMs);

  while (candidate < limit) {
    const m = candidate.getMinutes();
    const h = candidate.getHours();
    const dom = candidate.getDate();
    const dow = candidate.getDay();

    if (
      minutes.includes(m) &&
      hours.includes(h) &&
      doms.includes(dom) &&
      dows.includes(dow)
    ) {
      return new Date(candidate);
    }

    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  // Fallback: 30 min
  return new Date(from.getTime() + 30 * 60 * 1000);
}

// ─── Telegram Stub ─────────────────────────────────────────────────────────────
// TODO: Replace this stub with actual telegram delivery when implementing Telegram channel.
// The interface is already defined — just fill in the body of deliverTelegram().

async function deliverTelegram(_jobName: string, _content: string): Promise<void> {
  // STUB — Telegram not yet configured.
  // When implementing:
  //   1. Read config.channels.telegram.botToken and allowedUserIds
  //   2. POST to https://api.telegram.org/bot{token}/sendMessage
  //   3. Split content if > 4096 chars
  console.log('[CronScheduler] Telegram delivery stub called — not yet implemented');
}

// ─── CronScheduler Class ───────────────────────────────────────────────────────

interface SchedulerDeps {
  storePath: string;         // path to jobs.json
  handleChat: (          // direct reference to the handleChat function
    message: string,
    sessionId: string,
    sendSSE: (event: string, data: any) => void,
    pinnedMessages?: Array<{ role: string; content: string }>,
    abortSignal?: { aborted: boolean }
  ) => Promise<{ type: string; text: string; thinking?: string }>;
  broadcast: (data: object) => void; // WebSocket broadcast to all clients
  getIsModelBusy: () => boolean;     // check if a user chat is in-flight
  deliverTelegram?: (text: string) => Promise<void>; // optional telegram delivery
}

export class CronScheduler {
  private storePath: string;
  private store: CronStore;
  private deps: SchedulerDeps;
  private tickInterval: NodeJS.Timeout | null = null;
  private runningJobId: string | null = null;

  private defaultStore(): CronStore {
    return {
      heartbeat: {
        enabled: false,
        intervalMinutes: 30,
        activeHoursStart: 8,
        activeHoursEnd: 22,
      },
      jobs: [],
    };
  }

  constructor(deps: SchedulerDeps) {
    this.deps = deps;
    this.storePath = deps.storePath;
    this.store = this.loadStore();
    console.log(`[CronScheduler] Loaded ${this.store.jobs.length} jobs from ${this.storePath}`);
  }

  // ─── Store I/O ───────────────────────────────────────────────────────────────

  private loadStore(): CronStore {
    try {
      if (!fs.existsSync(this.storePath)) return this.defaultStore();
      const raw = fs.readFileSync(this.storePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return {
        heartbeat: { ...this.defaultStore().heartbeat, ...(parsed.heartbeat || {}) },
        jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
      };
    } catch {
      return this.defaultStore();
    }
  }

  private saveStore(): void {
    try {
      const dir = path.dirname(this.storePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.storePath, JSON.stringify(this.store, null, 2), 'utf-8');
    } catch (err: any) {
      console.error('[CronScheduler] Failed to save store:', err.message);
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  getJobs(): CronJob[] {
    return this.store.jobs;
  }

  getConfig(): HeartbeatConfig {
    return this.store.heartbeat;
  }

  updateConfig(partial: Partial<HeartbeatConfig>): void {
    this.store.heartbeat = { ...this.store.heartbeat, ...partial };
    this.saveStore();
    // Restart tick loop with new interval
    this.stop();
    this.start();
    this.broadcastUpdate();
  }

  createJob(partial: Partial<CronJob> & { name: string; prompt: string }): CronJob {
    const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date();

    const job: CronJob = {
      id,
      name: partial.name,
      prompt: partial.prompt,
      type: partial.type || 'recurring',
      schedule: partial.schedule || '*/30 * * * *',
      runAt: partial.runAt || null,
      enabled: partial.enabled !== false,
      priority: typeof partial.priority === 'number' ? partial.priority : this.store.jobs.length,
      delivery: 'web',
      lastRun: null,
      lastResult: null,
      lastDuration: null,
      nextRun: partial.type === 'one-shot' && partial.runAt
        ? partial.runAt
        : getNextRun(partial.schedule || null, now).toISOString(),
      status: 'scheduled',
      sessionId: null,
      createdAt: now.toISOString(),
    };

    this.store.jobs.push(job);
    this.saveStore();
    this.broadcastUpdate();
    console.log(`[CronScheduler] Created job "${job.name}" (${job.id})`);
    return job;
  }

  updateJob(id: string, partial: Partial<CronJob>): CronJob | null {
    const idx = this.store.jobs.findIndex(j => j.id === id);
    if (idx === -1) return null;
    this.store.jobs[idx] = { ...this.store.jobs[idx], ...partial };
    // Recalculate nextRun if schedule changed
    if (partial.schedule !== undefined || partial.runAt !== undefined) {
      const job = this.store.jobs[idx];
      job.nextRun = job.type === 'one-shot' && job.runAt
        ? job.runAt
        : getNextRun(job.schedule, new Date()).toISOString();
    }
    this.saveStore();
    this.broadcastUpdate();
    return this.store.jobs[idx];
  }

  deleteJob(id: string): boolean {
    const before = this.store.jobs.length;
    this.store.jobs = this.store.jobs.filter(j => j.id !== id);
    if (this.store.jobs.length === before) return false;
    this.saveStore();
    this.broadcastUpdate();
    return true;
  }

  reorderJobs(orderedIds: string[]): void {
    const byId = new Map(this.store.jobs.map(j => [j.id, j]));
    orderedIds.forEach((id, idx) => {
      const job = byId.get(id);
      if (job) job.priority = idx;
    });
    this.store.jobs.sort((a, b) => a.priority - b.priority);
    this.saveStore();
    this.broadcastUpdate();
  }

  async runJobNow(id: string): Promise<void> {
    const job = this.store.jobs.find(j => j.id === id);
    if (!job) return;
    // Run outside the normal tick — ignores model-busy guard (user explicitly requested)
    await this.executeJob(job);
  }

  // ─── Scheduler Loop ──────────────────────────────────────────────────────────

  start(): void {
    if (this.tickInterval) return;
    // Tick every 60 seconds — resolution is fine for minute-level cron
    this.tickInterval = setInterval(() => this.tick(), 60 * 1000);
    console.log('[CronScheduler] Started — ticking every 60s');
  }

  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  private isWithinActiveHours(): boolean {
    const { activeHoursStart, activeHoursEnd } = this.store.heartbeat;
    const hour = new Date().getHours();
    if (activeHoursStart <= activeHoursEnd) {
      return hour >= activeHoursStart && hour < activeHoursEnd;
    }
    // Overnight range e.g. 22–6
    return hour >= activeHoursStart || hour < activeHoursEnd;
  }

  private tick(): void {
    if (!this.store.heartbeat.enabled) return;
    if (this.runningJobId) return; // one at a time
    if (this.deps.getIsModelBusy()) {
      console.log('[CronScheduler] Tick skipped — model is busy with user chat');
      return;
    }
    if (!this.isWithinActiveHours()) {
      console.log('[CronScheduler] Tick skipped — outside active hours');
      return;
    }

    const now = new Date();
    const overdue = this.store.jobs
      .filter(j =>
        j.enabled &&
        j.status !== 'running' &&
        j.status !== 'paused' &&
        j.status !== 'completed' &&
        j.nextRun !== null &&
        new Date(j.nextRun) <= now
      )
      .sort((a, b) => a.priority - b.priority);

    if (overdue.length === 0) return;

    const job = overdue[0];
    console.log(`[CronScheduler] Tick — running job "${job.name}"`);
    // Fire async but don't await — tick returns immediately
    this.executeJob(job).catch(err =>
      console.error(`[CronScheduler] Job "${job.name}" crashed:`, err.message)
    );
  }

  // ─── Job Execution ────────────────────────────────────────────────────────────

  private async executeJob(job: CronJob): Promise<void> {
    this.runningJobId = job.id;
    const start = Date.now();

    // Mark as running
    job.status = 'running';
    this.saveStore();
    this.deps.broadcast({ type: 'tasks_update', jobs: this.store.jobs, config: this.store.heartbeat });
    this.deps.broadcast({ type: 'task_running', jobId: job.id, jobName: job.name });

    // Fake sessionId for the cron call — isolated from user sessions
    const cronSessionId = `cron_${job.id}`;

    // Collect SSE events emitted during the run
    const events: Array<{ type: string; data: any }> = [];
    const sendSSE = (type: string, data: any) => {
      events.push({ type, data });
      // Forward tool_call/tool_result events to UI so NOW card shows live progress
      if (['tool_call', 'tool_result', 'thinking', 'info'].includes(type)) {
        this.deps.broadcast({ type: 'task_sse', jobId: job.id, event: type, data });
      }
    };

    let resultText = '';
    let duration = 0;

    try {
      const result = await this.deps.handleChat(job.prompt, cronSessionId, sendSSE);
      resultText = result.text || '';
      duration = Date.now() - start;
    } catch (err: any) {
      resultText = `ERROR: ${err.message}`;
      duration = Date.now() - start;
      console.error(`[CronScheduler] Job "${job.name}" error:`, err.message);
    }

    // Determine if this is a silent OK or real output
    const isOk = /^\s*HEARTBEAT_OK\s*$/i.test(resultText);

    job.lastRun = new Date().toISOString();
    job.lastResult = resultText.slice(0, 500);
    job.lastDuration = duration;

    if (job.type === 'one-shot') {
      job.status = 'completed';
      job.nextRun = null;
    } else {
      job.status = 'scheduled';
      job.nextRun = getNextRun(job.schedule, new Date()).toISOString();
    }

    let automatedSession: AutomatedSession | null = null;

    if (!isOk && resultText.trim()) {
      // Create an automated chat session with the output
      const sessionId = `auto_${job.id}_${Date.now()}`;
      const title = `🕐 ${job.name} — ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;

      automatedSession = {
        id: sessionId,
        title,
        jobName: job.name,
        jobId: job.id,
        automated: true,
        createdAt: Date.now(),
        history: [
          { role: 'user', content: `[Automated Task: ${job.name}]\n\n${job.prompt}` },
          { role: 'ai', content: resultText },
        ],
      };

      job.sessionId = sessionId;
      console.log(`[CronScheduler] Job "${job.name}" produced output → auto session ${sessionId}`);

      // Deliver to Telegram if available
      if (this.deps.deliverTelegram) {
        const tgMsg = `\ud83d\udd50 <b>${job.name}</b>\n\n${resultText}`;
        this.deps.deliverTelegram(tgMsg).catch(err =>
          console.error(`[CronScheduler] Telegram delivery failed:`, err.message)
        );
      }
    } else {
      console.log(`[CronScheduler] Job "${job.name}" → HEARTBEAT_OK (suppressed)`);
    }

    this.saveStore();
    this.runningJobId = null;

    // Broadcast final state to all WebSocket clients
    this.deps.broadcast({
      type: 'task_done',
      jobId: job.id,
      jobName: job.name,
      isOk,
      duration,
      automatedSession,
      jobs: this.store.jobs,
      config: this.store.heartbeat,
    });
  }

  // ─── Broadcast Helper ─────────────────────────────────────────────────────────

  private broadcastUpdate(): void {
    this.deps.broadcast({ type: 'tasks_update', jobs: this.store.jobs, config: this.store.heartbeat });
  }
}
