// Main exports for LocalClaw

// Configuration
export { ConfigManager, getConfig, DEFAULT_CONFIG } from './config/config.js';

// Database
export { JobDatabase, getDatabase } from './db/database.js';

// Agents
export { OllamaClient, getOllamaClient } from './agents/ollama-client.js';
export { ManagerAgent } from './agents/manager.js';
export { ExecutorAgent } from './agents/executor.js';
export { VerifierAgent } from './agents/verifier.js';

// Orchestrator
export { AgentOrchestrator } from './gateway/orchestrator.js';

// Tools
export { getToolRegistry } from './tools/registry.js';
export { shellTool } from './tools/shell.js';
export { readTool, writeTool, editTool, listTool, deleteTool, renameTool, copyTool, mkdirTool, statTool, appendTool } from './tools/files.js';

// Types
export * from './types.js';
