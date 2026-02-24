import { Ollama } from 'ollama';
import { getConfig } from '../config/config';
import { AgentRole } from '../types';

export interface GenerateOutput {
  response: string;
  thinking?: string;
}

export interface ChatOutput {
  message: any;
  thinking?: string;
}

export class OllamaClient {
  private client: Ollama;
  private _endpoint: string;

  constructor() {
    this._endpoint = getConfig().getConfig().ollama.endpoint;
    this.client = new Ollama({ host: this._endpoint });
  }

  // Re-creates the Ollama client if the endpoint changed (e.g. after settings update)
  private getClient(): Ollama {
    const currentEndpoint = getConfig().getConfig().ollama.endpoint;
    if (currentEndpoint !== this._endpoint) {
      this._endpoint = currentEndpoint;
      this.client = new Ollama({ host: this._endpoint });
    }
    return this.client;
  }

  async generate(
    prompt: string,
    role: AgentRole,
    options?: {
      temperature?: number;
      format?: 'json';
      system?: string;
      num_ctx?: number;
      num_predict?: number;
      think?: boolean | 'high' | 'medium' | 'low';
    }
  ): Promise<string> {
    const out = await this.generateWithThinking(prompt, role, options);
    return out.response;
  }

  async chatWithThinking(
    messages: Array<any>,
    role: AgentRole,
    options?: {
      temperature?: number;
      num_ctx?: number;
      num_predict?: number;
      think?: boolean | 'high' | 'medium' | 'low';
      tools?: any[];
    }
  ): Promise<ChatOutput> {
    const liveConfig = getConfig().getConfig();
    const model = liveConfig.models.roles[role] || liveConfig.models.primary;
    const requestedThink = options?.think;
    const thinkCandidates: Array<boolean | 'high' | 'medium' | 'low' | undefined> = [];
    const pushUnique = (v: boolean | 'high' | 'medium' | 'low' | undefined) => {
      if (!thinkCandidates.some(x => x === v)) thinkCandidates.push(v);
    };
    pushUnique(requestedThink);
    // Prefer low/no-think for latency; keep think=true only as last resort compatibility.
    if (requestedThink !== 'low') pushUnique('low');
    pushUnique(undefined);
    if (requestedThink !== true) pushUnique(true);
    pushUnique('medium');

    let lastError: any = null;
    for (const think of thinkCandidates) {
      try {
        const response: any = await this.getClient().chat({
          model,
          messages,
          tools: options?.tools,
          ...(Array.isArray(options?.tools) && options!.tools!.length ? { tool_choice: 'auto' } : {}),
          options: {
            temperature: options?.temperature ?? 0.25,
            top_p: 0.9,
            num_ctx: options?.num_ctx ?? 4096,
            num_predict: options?.num_predict ?? 256,
          },
          ...(think === undefined ? {} : { think }),
          stream: false,
        } as any);

        const message = response?.message || {
          role: 'assistant',
          content: String(response?.response || ''),
        };
        return { message, thinking: response?.thinking };
      } catch (error: any) {
        lastError = error;
        const msg = String(error?.message || error || '');
        const thinkUnsupported = /think value .* not supported|invalid think|think .* not supported/i.test(msg);
        if (!thinkUnsupported) {
          throw new Error(`Ollama chat failed: ${msg}`);
        }
      }
    }
    throw new Error(`Ollama chat failed: ${lastError?.message || 'Unknown error'}`);
  }

  async generateWithThinking(
    prompt: string,
    role: AgentRole,
    options?: {
      temperature?: number;
      format?: 'json';
      system?: string;
      num_ctx?: number;
      num_predict?: number;
      think?: boolean | 'high' | 'medium' | 'low';
    }
  ): Promise<GenerateOutput> {
    const liveConfig = getConfig().getConfig();
    const model = liveConfig.models.roles[role] || liveConfig.models.primary;
    const requestedThink = options?.think;
    const thinkCandidates: Array<boolean | 'high' | 'medium' | 'low' | undefined> = [];
    const pushUnique = (v: boolean | 'high' | 'medium' | 'low' | undefined) => {
      if (!thinkCandidates.some(x => x === v)) thinkCandidates.push(v);
    };
    pushUnique(requestedThink);
    // Prefer low/no-think for latency; keep think=true only as last resort compatibility.
    if (requestedThink !== 'low') pushUnique('low');
    pushUnique(undefined);
    if (requestedThink !== true) pushUnique(true);
    pushUnique('medium');

    let lastError: any = null;
    for (const think of thinkCandidates) {
      try {
        const response = await this.getClient().generate({
          model,
          prompt,
          system: options?.system,
          format: options?.format,
          options: {
            temperature: options?.temperature ?? 0.3,
            top_p: 0.9,
            num_ctx: options?.num_ctx ?? 2048,
            num_predict: options?.num_predict ?? 256,
          },
          ...(think === undefined ? {} : { think }),
          stream: false
        });

        return { response: response.response, thinking: response.thinking };
      } catch (error: any) {
        lastError = error;
        const msg = String(error?.message || error || '');
        const thinkUnsupported = /think value .* not supported|invalid think|think .* not supported/i.test(msg);
        if (!thinkUnsupported) {
          throw new Error(`Ollama generation failed: ${msg}`);
        }
      }
    }
    throw new Error(`Ollama generation failed: ${lastError?.message || 'Unknown error'}`);
  }

  async generateWithRetry(
    prompt: string,
    role: AgentRole,
    options?: {
      temperature?: number;
      format?: 'json';
      system?: string;
      num_ctx?: number;
      num_predict?: number;
      think?: boolean | 'high' | 'medium' | 'low';
    },
    maxRetries: number = 3
  ): Promise<string> {
    const out = await this.generateWithRetryThinking(prompt, role, options, maxRetries);
    return out.response;
  }

  async generateWithRetryThinking(
    prompt: string,
    role: AgentRole,
    options?: {
      temperature?: number;
      format?: 'json';
      system?: string;
      num_ctx?: number;
      num_predict?: number;
      think?: boolean | 'high' | 'medium' | 'low';
    },
    maxRetries: number = 3
  ): Promise<GenerateOutput> {
    let lastError: Error | null = null;

    for (let i = 0; i < maxRetries; i++) {
      try {
        return await this.generateWithThinking(prompt, role, options);
      } catch (error: any) {
        lastError = error;
        console.warn(`Attempt ${i + 1}/${maxRetries} failed:`, error.message);
        if (i < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
        }
      }
    }

    throw lastError || new Error('Generation failed after retries');
  }

  // Dedicated synthesis call — higher context, no tool loop, just combine facts into prose
  async synthesize(facts: string[], originalQuestion: string, systemPrompt: string): Promise<string> {
    const out = await this.synthesizeWithThinking(facts, originalQuestion, systemPrompt);
    return out.response;
  }

  async synthesizeWithThinking(
    facts: string[],
    originalQuestion: string,
    systemPrompt: string,
    think: boolean | 'high' | 'medium' | 'low' = 'high'
  ): Promise<GenerateOutput> {
    const factsText = facts.map((f, i) => `[${i + 1}] ${f}`).join('\n\n');

    const prompt =
      `You found the following information to answer the user's question.\n\n` +
      `User asked: ${originalQuestion}\n\n` +
      `Facts gathered:\n${factsText}\n\n` +
      `Write a clear, complete response using these facts. ` +
      `Be specific. Use 2-5 sentences per topic. ` +
      `Do not say "based on search results" — just answer directly.`;

    const raw = await this.generateWithRetryThinking(prompt, 'executor', {
      temperature: 0.4,
      system: systemPrompt,
      num_ctx: 3072,  // more room since there's no tool loop overhead
      think,
    });

    return {
      response: raw.response
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<think>[\s\S]*/gi, '')
      .trim(),
      thinking: raw.thinking,
    };
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await this.getClient().list();
      return response.models.map((m: any) => m.name);
    } catch (error: any) {
      throw new Error(`Failed to list models: ${error.message}`);
    }
  }

  async checkModelExists(modelName: string): Promise<boolean> {
    try {
      const models = await this.listModels();
      return models.includes(modelName);
    } catch {
      return false;
    }
  }

  async pullModel(modelName: string): Promise<void> {
    console.log(`Pulling model: ${modelName}...`);
    try {
      await this.client.pull({ model: modelName, stream: false });
      console.log(`Model ${modelName} pulled successfully`);
    } catch (error: any) {
      throw new Error(`Failed to pull model: ${error.message}`);
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.listModels();
      return true;
    } catch {
      return false;
    }
  }

  parseJSON<T>(response: string): T {
    let cleaned = response.trim();

    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/m, '').replace(/\n?```\s*$/m, '');
    }

    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    cleaned = cleaned.replace(/<think>[\s\S]*/gi, '').trim();

    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');

    if (start === -1) {
      console.error('Failed to parse JSON response. Raw output was:\n', response.slice(0, 300));
      throw new Error(`Invalid JSON response from model: SyntaxError: Unexpected end of JSON input`);
    }

    if (end !== -1 && end > start) {
      cleaned = cleaned.slice(start, end + 1);
    } else {
      console.warn('JSON appears truncated, attempting repair...');
      cleaned = cleaned.slice(start);
      cleaned = cleaned.replace(/,\s*$/, '');

      let openBraces = 0;
      let openBrackets = 0;
      let inString = false;
      let escaped = false;
      for (const ch of cleaned) {
        if (escaped) { escaped = false; continue; }
        if (ch === '\\' && inString) { escaped = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') openBraces++;
        else if (ch === '}') openBraces = Math.max(0, openBraces - 1);
        else if (ch === '[') openBrackets++;
        else if (ch === ']') openBrackets = Math.max(0, openBrackets - 1);
      }
      if (inString) cleaned += '"';
      cleaned += ']'.repeat(Math.max(0, openBrackets));
      cleaned += '}'.repeat(Math.max(0, openBraces));
    }

    try {
      return JSON.parse(cleaned) as T;
    } catch (error) {
      console.error('Failed to parse JSON response. Raw output was:\n', response.slice(0, 300));
      throw new Error(`Invalid JSON response from model: ${error}`);
    }
  }
}

let ollamaInstance: OllamaClient | null = null;

export function getOllamaClient(): OllamaClient {
  if (!ollamaInstance) {
    ollamaInstance = new OllamaClient();
  }
  return ollamaInstance;
}
