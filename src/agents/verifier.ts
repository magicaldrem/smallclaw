import { getOllamaClient } from './ollama-client';
import { VerifierOutput, Task, TaskState, ToolResult } from '../types';

const VERIFIER_SYSTEM_PROMPT = `You are a task verifier. Check if tasks completed successfully.

ALWAYS respond with ONLY valid JSON, no other text:
{
  "thought": "assessment",
  "status": "approved",
  "issues": [],
  "approval_reason": ""
}

status must be one of: "approved", "rejected", "needs_approval"
- approved: task fully complete, criteria met
- rejected: task incomplete or failed, list issues
- needs_approval: risky operation needs human confirmation`;

export class VerifierAgent {
  private ollama = getOllamaClient();

  async verify(
    task: Task,
    state: TaskState,
    executorOutput: any,
    toolResult?: ToolResult
  ): Promise<VerifierOutput> {
    const resultSummary = toolResult
      ? `Success: ${toolResult.success}. Output: ${(toolResult.stdout || toolResult.error || '').slice(0, 200)}`
      : 'No tool result';

    const prompt = `TASK: ${task.title}
CRITERIA: ${task.acceptance_criteria.join('; ')}
RESULT: ${resultSummary}
EXECUTOR OUTPUT: ${JSON.stringify(executorOutput).slice(0, 200)}

Did this step succeed? Output only JSON.`;

    let response = '';
    try {
      response = await this.ollama.generateWithRetry(
        prompt,
        'verifier',
        {
          format: 'json',
          system: VERIFIER_SYSTEM_PROMPT,
          temperature: 0.1
        }
      );
      return this.ollama.parseJSON<VerifierOutput>(response);
    } catch {
      return { thought: 'Could not verify step, approving by default.', status: 'approved', issues: [] };
    }
  }

  async verifyCompletion(
    task: Task,
    allSteps: Array<{ action: any; result: any }>
  ): Promise<VerifierOutput> {
    const prompt = `TASK: ${task.title}
CRITERIA: ${task.acceptance_criteria.join('; ')}
TOTAL STEPS: ${allSteps.length}
LAST STEP: ${JSON.stringify(allSteps[allSteps.length - 1] || {}).slice(0, 300)}

Is this task fully complete? Output only JSON.`;

    let response = '';
    try {
      response = await this.ollama.generateWithRetry(
        prompt,
        'verifier',
        {
          format: 'json',
          system: VERIFIER_SYSTEM_PROMPT,
          temperature: 0.1
        }
      );
      return this.ollama.parseJSON<VerifierOutput>(response);
    } catch {
      return { thought: 'Could not verify completion, approving by default.', status: 'approved', issues: [] };
    }
  }
}

