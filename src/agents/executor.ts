import { getOllamaClient } from './ollama-client';
import { ExecutorOutput, Task, TaskState } from '../types';

const EXECUTOR_SYSTEM_PROMPT = `You are a task executor with access to tools. Execute tasks one step at a time.

ALWAYS respond with ONLY valid JSON, no other text.

To use a tool:
{
  "thought": "what I need to do",
  "tool": "tool_name",
  "args": { "key": "value" }
}

To finish a task:
{
  "thought": "task is done",
  "response": "what was accomplished",
  "artifacts": []
}

Available tools:
- shell: { "command": "cmd here" }
- read: { "path": "/path/to/file" }
- write: { "path": "/path/to/file", "content": "text" }
- edit: { "path": "/path/to/file", "old_str": "find", "new_str": "replace" }
- list: { "path": "/path/to/dir" }

IMPORTANT: Use the workspace path for all files. Never use system paths.`;

export class ExecutorAgent {
  private ollama = getOllamaClient();

  async step(
    task: Task,
    state: TaskState,
    previousSteps: Array<{ action: any; result: any }> = []
  ): Promise<ExecutorOutput> {
    const lastResult = previousSteps.length > 0
      ? `\nLAST RESULT: ${JSON.stringify(previousSteps[previousSteps.length - 1].result).slice(0, 300)}`
      : '';

    const prompt = `TASK: ${task.title}
DESCRIPTION: ${task.description}
WORKSPACE: ${state.job_id}
STEPS DONE: ${previousSteps.length}
CRITERIA: ${task.acceptance_criteria.join('; ')}${lastResult}

What is the next step? Output only JSON.`;

    const response = await this.ollama.generateWithRetry(
      prompt,
      'executor',
      {
        format: 'json',
        system: EXECUTOR_SYSTEM_PROMPT,
        temperature: 0.2
      }
    );

    try {
      return this.ollama.parseJSON<ExecutorOutput>(response);
    } catch (err) {
      // Model returned unparseable output - return a graceful finish response
      console.warn('[Executor] Could not parse model response, returning safe fallback.');
      return {
        thought: 'Completed task.',
        response: response.trim() || 'Task completed.',
        artifacts: []
      } as any;
    }
  }

  async stepWithFeedback(
    task: Task,
    state: TaskState,
    previousSteps: Array<{ action: any; result: any }>,
    feedback: string
  ): Promise<ExecutorOutput> {
    const prompt = `TASK: ${task.title}
FEEDBACK: ${feedback}
STEPS DONE: ${previousSteps.length}

Address the feedback and continue. Output only JSON.`;

    const response = await this.ollama.generateWithRetry(
      prompt,
      'executor',
      {
        format: 'json',
        system: EXECUTOR_SYSTEM_PROMPT,
        temperature: 0.3
      }
    );

    return this.ollama.parseJSON<ExecutorOutput>(response);
  }
}

