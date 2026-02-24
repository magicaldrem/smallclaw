import PTYManager from '../gateway/pty-manager';
import path from 'path';
import { getConfig } from '../config/config.js';
import { ToolResult } from '../types.js';


export interface ShellToolArgs {
  command: string;
  cwd?: string;
}

export async function executeShell(args: ShellToolArgs): Promise<ToolResult> {
  const config = getConfig().getConfig();
  const permissions = config.tools.permissions.shell;
  const workspacePath = config.workspace.path;

  // Determine working directory
  const cwd = args.cwd ? path.resolve(args.cwd) : workspacePath;

  // Security check: workspace only
  if (permissions.workspace_only) {
    if (!cwd.startsWith(workspacePath)) {
      return {
        success: false,
        error: `Security: Command execution outside workspace is not allowed. Workspace: ${workspacePath}, Requested: ${cwd}`
      };
    }
  }

  // Check blocked patterns
  for (const pattern of permissions.blocked_patterns) {
    if (args.command.includes(pattern)) {
      return {
        success: false,
        error: `Security: Command blocked due to dangerous pattern: "${pattern}"`
      };
    }
  }

  // Additional safety checks
  const dangerousCommands = [
    /rm\s+-rf\s+\//,  // rm -rf with root
    /mkfs/,           // format filesystem
    /dd\s+if=/,       // disk operations
    />\s*\/dev\//,    // writing to devices
    /sudo/,           // privilege escalation
    /su\s/,           // switch user
    /chmod\s+777/,    // dangerous permissions
  ];

  for (const pattern of dangerousCommands) {
    if (pattern.test(args.command)) {
      return {
        success: false,
        error: `Security: Potentially destructive command detected: ${args.command}`
      };
    }
  }

  try {
    const pty = PTYManager.getInstance();
    const output = await pty.runCommand(args.command);
    return {
      success: true,
      stdout: output.trim(),
      stderr: '',
      exitCode: 0
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      stdout: '',
      stderr: '',
      exitCode: 1
    };
  }
}

export const shellTool = {
  name: 'shell',
  description: 'Execute terminal commands in the workspace',
  execute: executeShell,
  schema: {
    command: 'string (required) - The command to execute',
    cwd: 'string (optional) - Working directory, defaults to workspace'
  }
};
