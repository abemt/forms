import { config } from '../../config.js';
import { createLogger } from '../../logger.js';

const log = createLogger('ai');

export class AiConfigError extends Error {}
export class AiRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

interface ChatOptions {
  system: string;
  user: string;
  /** Marker included in logs to identify the call type. */
  purpose: string;
}

function extractJson(content: string): unknown {
  const trimmed = content.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    // Fall back to the outermost JSON object in the text.
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(unfenced.slice(start, end + 1));
    }
    throw new AiRequestError('AI returned a response that is not valid JSON');
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Minimal client for any OpenAI-compatible chat-completions endpoint
 * (OpenAI, Azure OpenAI, OpenRouter, Groq, Ollama, LM Studio, ...).
 */
export class AiClient {
  constructor(
    private readonly settings: {
      apiKey: string;
      baseUrl: string;
      model: string;
      maxRetries: number;
      timeoutMs: number;
    } = config.ai,
  ) {}

  get model(): string {
    return this.settings.model;
  }

  assertConfigured(): void {
    if (!this.settings.apiKey && !/localhost|127\.0\.0\.1/.test(this.settings.baseUrl)) {
      throw new AiConfigError(
        'AI provider is not configured. Set AI_API_KEY (and optionally AI_BASE_URL / AI_MODEL) ' +
          'in the server environment, then restart. See .env.example.',
      );
    }
  }

  /** Send a chat request and parse the reply as JSON, with retries and backoff. */
  async chatJSON(options: ChatOptions): Promise<unknown> {
    this.assertConfigured();
    const messages: ChatMessage[] = [
      { role: 'system', content: options.system },
      { role: 'user', content: options.user },
    ];

    let useJsonMode = true;
    let lastError: Error = new AiRequestError('AI request failed');
    for (let attempt = 0; attempt <= this.settings.maxRetries; attempt++) {
      if (attempt > 0) {
        const backoff = Math.min(15_000, 1000 * 2 ** (attempt - 1)) + Math.random() * 500;
        await sleep(backoff);
      }
      try {
        return await this.requestOnce(messages, useJsonMode, options.purpose);
      } catch (err) {
        lastError = err as Error;
        if (err instanceof AiRequestError && err.status === 400 && useJsonMode) {
          // Some providers reject response_format; retry without it.
          useJsonMode = false;
          attempt--;
          continue;
        }
        const retriable =
          !(err instanceof AiRequestError) ||
          err.status === undefined ||
          err.status === 429 ||
          err.status >= 500;
        if (!retriable) throw err;
        log.warn(`${options.purpose}: attempt ${attempt + 1} failed: ${lastError.message}`);
      }
    }
    throw lastError;
  }

  private async requestOnce(
    messages: ChatMessage[],
    jsonMode: boolean,
    purpose: string,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.settings.timeoutMs);
    const started = Date.now();
    try {
      const body: Record<string, unknown> = {
        model: this.settings.model,
        temperature: 0,
        messages,
      };
      if (jsonMode) body.response_format = { type: 'json_object' };

      const res = await fetch(`${this.settings.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.settings.apiKey ? { authorization: `Bearer ${this.settings.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 400);
        throw new AiRequestError(`AI provider returned HTTP ${res.status}: ${detail}`, res.status);
      }
      const payload = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new AiRequestError('AI provider returned an empty response');
      log.info(`${purpose}: ok in ${Date.now() - started}ms`);
      return extractJson(content);
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new AiRequestError(`AI request timed out after ${this.settings.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

export const aiClient = new AiClient();
