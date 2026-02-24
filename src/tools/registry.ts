import { ToolResult } from '../types.js';
import { shellTool } from './shell.js';
import { readTool, writeTool, editTool, listTool, deleteTool, renameTool, copyTool, mkdirTool, statTool, appendTool } from './files.js';
import { webSearchTool, webFetchTool } from './web.js';
import { memoryWriteTool } from './memory.js';
import { skillListTool, skillSearchTool, skillInstallTool, skillRemoveTool, skillExecTool } from './skills.js';
import { timeNowTool } from './time.js';

export interface Tool {
  name: string;
  description: string;
  execute: (args: any) => Promise<ToolResult>;
  schema: Record<string, string>;
}

class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  constructor() {
    // Core filesystem + shell
    this.register(shellTool);
    this.register(readTool);
    this.register(writeTool);
    this.register(editTool);
    this.register(listTool);
    this.register(deleteTool);
    // Additional filesystem utilities
    this.register(renameTool);
    this.register(copyTool);
    this.register(mkdirTool);
    this.register(statTool);
    this.register(appendTool);
    // Web tools
    this.register(webSearchTool);
    this.register(webFetchTool);
    // Memory tool
    this.register(memoryWriteTool);
    // Time tool (system clock — no network)
    this.register(timeNowTool);
    // ClawHub skills tools
    this.register(skillListTool);
    this.register(skillSearchTool);
    this.register(skillInstallTool);
    this.register(skillRemoveTool);
    this.register(skillExecTool);
  }

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  async execute(toolName: string, args: any): Promise<ToolResult> {
    const tool = this.tools.get(toolName);
    
    if (!tool) {
      return {
        success: false,
        error: `Tool not found: ${toolName}. Available tools: ${Array.from(this.tools.keys()).join(', ')}`
      };
    }

    try {
      return await tool.execute(args);
    } catch (error: any) {
      return {
        success: false,
        error: `Tool execution failed: ${error.message}`
      };
    }
  }

  getToolSchemas(): string {
    const tools = this.list();
    return tools.map(tool => {
      const schemaStr = Object.entries(tool.schema)
        .map(([key, desc]) => `  - ${key}: ${desc}`)
        .join('\n');
      
      return `${tool.name}: ${tool.description}\n${schemaStr}`;
    }).join('\n\n');
  }

  getToolDefinitionsForChat(): any[] {
    const tools = this.list();
    const inferParamSchema = (key: string, desc: string): any => {
      const k = String(key || '').toLowerCase();
      const d = String(desc || '').toLowerCase();
      if (/\b(true|false|boolean)\b/.test(d) || /\b(force|strict|recursive|enabled|disabled|stream|dry_run|dry run)\b/.test(k)) {
        return { type: 'boolean', description: String(desc || '') };
      }
      if (
        /\b(integer|number|count|max|min|limit|timeout|ms|seconds?|minutes?|days?)\b/.test(d)
        || /(max|min|count|limit|timeout|num|days|hours|minutes|seconds|retries|offset|line|chars|size|port)$/.test(k)
      ) {
        return { type: 'number', description: String(desc || '') };
      }
      if (/\bjson\b/.test(d) || /(args|params|options|payload|values)_?json$/.test(k)) {
        return {
          anyOf: [
            { type: 'object' },
            { type: 'array' },
            { type: 'string' },
          ],
          description: String(desc || ''),
        };
      }
      return { type: 'string', description: String(desc || '') };
    };
    return tools.map((tool) => {
      const properties: Record<string, any> = {};
      for (const [key, desc] of Object.entries(tool.schema || {})) {
        properties[key] = inferParamSchema(key, String(desc || ''));
      }
      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: {
            type: 'object',
            properties,
            additionalProperties: true,
          },
        },
      };
    });
  }

  isToolEnabled(toolName: string, enabledTools: string[]): boolean {
    return enabledTools.includes(toolName);
  }
}

// Singleton instance
let registryInstance: ToolRegistry | null = null;

export function getToolRegistry(): ToolRegistry {
  if (!registryInstance) {
    registryInstance = new ToolRegistry();
  }
  return registryInstance;
}
