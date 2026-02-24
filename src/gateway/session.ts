/**
 * session.ts - Simple session state for LocalClaw v2
 * 
 * No plans. No verified facts. No workspace ledger. No self-learning.
 * Just conversation history.
 */

import fs from 'fs';
import path from 'path';
import { getConfig } from '../config/config';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface Session {
  id: string;
  history: ChatMessage[];
  workspace: string;
  createdAt: number;
  lastActiveAt: number;
}

const sessions = new Map<string, Session>();

const SESSION_DIR = (() => {
  try {
    return path.join(getConfig().getConfigDir(), 'sessions');
  } catch {
    return path.join(process.cwd(), '.localclaw', 'sessions');
  }
})();

function ensureSessionDir(): void {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
}

function getSessionPath(id: string): string {
  return path.join(SESSION_DIR, `${id}.json`);
}

export function getSession(id: string): Session {
  if (sessions.has(id)) {
    return sessions.get(id)!;
  }

  ensureSessionDir();
  const filePath = getSessionPath(id);

  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const session: Session = {
        id: data.id || id,
        history: Array.isArray(data.history) ? data.history : [],
        workspace: data.workspace || getConfig().getWorkspacePath(),
        createdAt: data.createdAt || Date.now(),
        lastActiveAt: data.lastActiveAt || Date.now(),
      };
      sessions.set(id, session);
      return session;
    } catch {
      // Corrupted file, create new session
    }
  }

  const session: Session = {
    id,
    history: [],
    workspace: getConfig().getWorkspacePath(),
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };
  sessions.set(id, session);
  saveSession(id);
  return session;
}

export function addMessage(id: string, msg: ChatMessage): void {
  const session = getSession(id);
  session.history.push(msg);
  session.lastActiveAt = Date.now();
  
  // Keep last 20 messages to avoid context overflow
  if (session.history.length > 20) {
    session.history = session.history.slice(-20);
  }
  
  saveSession(id);
}

export function getHistory(id: string, maxTurns: number = 10): ChatMessage[] {
  const session = getSession(id);
  // Return last N messages (2 messages per turn = user + assistant)
  const maxMessages = maxTurns * 2;
  return session.history.slice(-maxMessages);
}

export function clearHistory(id: string): void {
  const session = getSession(id);
  session.history = [];
  session.lastActiveAt = Date.now();
  saveSession(id);
}

function saveSession(id: string): void {
  const session = sessions.get(id);
  if (!session) return;

  ensureSessionDir();
  try {
    fs.writeFileSync(getSessionPath(id), JSON.stringify(session, null, 2));
  } catch (err) {
    console.warn(`[session] Failed to save session ${id}:`, err);
  }
}

export function getWorkspace(id: string): string {
  return getSession(id).workspace;
}

export function setWorkspace(id: string, workspacePath: string): void {
  const session = getSession(id);
  session.workspace = workspacePath;
  session.lastActiveAt = Date.now();
  saveSession(id);
}
