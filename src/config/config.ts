import fs from 'fs';
import path from 'path';
import os from 'os';
import { LocalClawConfig } from '../types.js';

// Prefer config next to the project (D:\localclaw\.localclaw), fall back to home
const PROJECT_CONFIG = path.join(__dirname, '..', '..', '.localclaw');
const HOME_CONFIG = path.join(os.homedir(), '.localclaw');
const CONFIG_DIR = fs.existsSync(PROJECT_CONFIG) ? PROJECT_CONFIG : HOME_CONFIG;
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const WORKSPACE_DIR = path.join(os.homedir(), 'localclaw', 'workspace');

export const DEFAULT_CONFIG: LocalClawConfig = {
  version: '0.1.0',
  gateway: {
    port: 18789,
    host: '127.0.0.1',
    auth: {
      enabled: true,
      token: undefined
    }
  },
  ollama: {
    endpoint: 'http://localhost:11434',
    timeout: 120,
    concurrency: {
      llm_workers: 1,
      tool_workers: 3
    }
  },
  models: {
    primary: 'qwen3:4b',
    roles: {
      manager: 'qwen3:4b',
      executor: 'qwen3:4b',
      verifier: 'qwen3:4b'
    }
  },
  tools: {
    enabled: ['shell', 'read', 'write', 'edit', 'search'],
    permissions: {
      shell: {
        workspace_only: true,
        confirm_destructive: true,
        blocked_patterns: ['rm -rf /', 'del C:\\Windows', 'format']
      },
      files: {
        allowed_paths: [WORKSPACE_DIR],
        blocked_paths: ['/etc', '/System', 'C:\\Windows', '/usr', '/bin']
      },
      browser: {
        profile: 'automation',
        headless: false
      }
    }
  },
  skills: {
    directory: path.join(CONFIG_DIR, 'skills'),
    registries: ['https://clawhub.ai'],
    auto_update: false
  },
  memory: {
    provider: 'chromadb',
    path: path.join(CONFIG_DIR, 'memory'),
    embedding_model: 'nomic-embed-text'
  },
  memory_options: {
    auto_confirm: true,
    audit: true,
    truncate_length: 1000
  },
  heartbeat: {
    enabled: true,
    interval_minutes: 30,
    workspace_file: 'HEARTBEAT.md'
  },
  workspace: {
    path: WORKSPACE_DIR
  }
};

export class ConfigManager {
  private config: LocalClawConfig;

  constructor() {
    this.config = this.loadConfig();
  }

  private loadConfig(): LocalClawConfig {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const loadedConfig = JSON.parse(data);
        // Merge with defaults to ensure all fields exist
        return { ...DEFAULT_CONFIG, ...loadedConfig };
      }
    } catch (error) {
      console.warn('Failed to load config, using defaults:', error);
    }
    return DEFAULT_CONFIG;
  }

  public getConfig(): LocalClawConfig {
    return this.config;
  }

  public updateConfig(updates: Partial<LocalClawConfig>): void {
    this.config = { ...this.config, ...updates };
    this.saveConfig();
  }

  public saveConfig(): void {
    try {
      // Ensure config directory exists
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
      }
      
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2));
    } catch (error) {
      console.error('Failed to save config:', error);
      throw error;
    }
  }

  public ensureDirectories(): void {
    const dirs = [
      CONFIG_DIR,
      this.config.workspace.path,
      this.config.skills.directory,
      this.config.memory.path,
      path.join(CONFIG_DIR, 'sessions'),
      path.join(CONFIG_DIR, 'logs')
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  public getConfigDir(): string {
    return CONFIG_DIR;
  }

  public getWorkspacePath(): string {
    return this.config.workspace.path;
  }

  public getDatabasePath(): string {
    return path.join(CONFIG_DIR, 'jobs.db');
  }
}

// Singleton instance
let configInstance: ConfigManager | null = null;

export function getConfig(): ConfigManager {
  if (!configInstance) {
    configInstance = new ConfigManager();
  }
  return configInstance;
}
