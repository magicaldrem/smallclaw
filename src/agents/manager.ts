import { randomUUID } from 'crypto';
import { getOllamaClient } from './ollama-client';
import { ManagerOutput, TaskState } from '../types';

const MANAGER_SYSTEM_PROMPT = `You are a task planner. Output ONLY valid JSON, nothing else.

Format:
{"thought":"reasoning","plan":[{"id":"task_1","title":"name","description":"what to do","dependencies":[],"acceptance_criteria":["how to verify"],"assigned_to":"executor"}],"risks":[],"requires_approval":false}`;

export class ManagerAgent {
  private ollama = getOllamaClient();

  async plan(mission: string, state: TaskState): Promise<ManagerOutput> {
    const prompt = `Mission: ${mission}\n\nCreate a plan with 1-3 tasks. Output only JSON.`;

    let response = '';
    try {
      response = await this.ollama.generateWithRetry(prompt, 'manager', {
        format: 'json',
        system: MANAGER_SYSTEM_PROMPT,
        temperature: 0.1
      });
      return this.ollama.parseJSON<ManagerOutput>(response);
    } catch (err) {
      // If model fails or returns garbage, build a safe single-task fallback plan
      console.warn('[Manager] Model failed, using fallback plan');
      return this.fallbackPlan(mission);
    }
  }

  private fallbackPlan(mission: string): ManagerOutput {
    return {
      thought: `Execute the mission directly: ${mission}`,
      plan: [{
        id: randomUUID(),
        title: mission.slice(0, 60),
        description: mission,
        dependencies: [],
        acceptance_criteria: ['Task executed without errors'],
        assigned_to: 'executor'
      }],
      risks: [],
      requires_approval: false
    };
  }

  async replan(mission: string, state: TaskState, feedback: string[]): Promise<ManagerOutput> {
    const prompt = `Mission: ${mission}\nFeedback: ${feedback.join('; ')}\n\nRevise plan. Output only JSON.`;
    try {
      const response = await this.ollama.generateWithRetry(prompt, 'manager', {
        format: 'json',
        system: MANAGER_SYSTEM_PROMPT,
        temperature: 0.2
      });
      return this.ollama.parseJSON<ManagerOutput>(response);
    } catch {
      return this.fallbackPlan(mission);
    }
  }
}

