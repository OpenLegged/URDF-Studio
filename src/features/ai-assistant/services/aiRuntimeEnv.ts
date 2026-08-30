interface AiRuntimeEnvSource {
  [key: string]: string | undefined;
  VITE_API_KEY?: string;
  VITE_OPENAI_API_KEY?: string;
  VITE_GEMINI_API_KEY?: string;
  VITE_OPENAI_BASE_URL?: string;
  VITE_OPENAI_MODEL?: string;
  VITE_OPENAI_CONTEXT_WINDOW_TOKENS?: string;
  VITE_OPENAI_THINKING_MODE?: string;
  VITE_OPENAI_REASONING_EFFORT?: string;
  VITE_AI_BACKEND_URL?: string;
  API_KEY?: string;
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  OPENAI_CONTEXT_WINDOW_TOKENS?: string;
  OPENAI_THINKING_MODE?: string;
  OPENAI_REASONING_EFFORT?: string;
  AI_BACKEND_URL?: string;
}

export type AiThinkingMode = 'auto' | 'enabled' | 'disabled';
export type AiReasoningEffort = 'low' | 'medium' | 'high' | 'max';

export interface AiThinkingRequestOptions {
  thinking?: { type: Exclude<AiThinkingMode, 'auto'> };
  reasoning_effort?: AiReasoningEffort;
}

export interface AiRuntimeEnv {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Configured model input window used by the browser Agent's token budget. */
  contextWindowTokens: number;
  /** Provider thinking toggle. `auto` preserves the model/provider default. */
  thinkingMode: AiThinkingMode;
  /** Reasoning budget sent only when thinking is explicitly enabled. */
  reasoningEffort: AiReasoningEffort;
  /**
   * Managed AI mode: base URL of the backend AI proxy
   * (e.g. `/api/ai/urdf-studio`). When set, AI requests carry structured
   * context to the backend, which owns prompts and provider credentials —
   * no AI key lives in the browser. When empty, the direct BYOK mode above
   * (apiKey/baseUrl/model) applies.
   */
  backendUrl: string;
}

const readImportMetaEnv = (): AiRuntimeEnvSource => {
  return ((import.meta as ImportMeta & { env?: AiRuntimeEnvSource }).env ?? {}) as AiRuntimeEnvSource;
};

const readProcessEnv = (): AiRuntimeEnvSource => {
  return typeof process !== 'undefined' ? process.env : {};
};

const firstNonEmpty = (...values: Array<string | undefined>): string => {
  for (const value of values) {
    const trimmedValue = value?.trim();
    if (trimmedValue) {
      return trimmedValue;
    }
  }
  return '';
};

const positiveInteger = (value: string, fallback: number): number => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1024 ? parsed : fallback;
};

const enumValue = <T extends string>(
  value: string,
  allowed: readonly T[],
  fallback: T,
): T => allowed.includes(value as T) ? value as T : fallback;

/**
 * Build the non-standard OpenAI-compatible fields understood by providers such
 * as DeepSeek. In `auto` mode no extra field is sent, so native reasoning
 * models can keep their own defaults without breaking other compatible APIs.
 */
export function buildAiThinkingRequestOptions(
  runtime: Pick<AiRuntimeEnv, 'thinkingMode' | 'reasoningEffort'>,
  reasoningEffort: AiReasoningEffort = runtime.reasoningEffort,
): AiThinkingRequestOptions {
  if (runtime.thinkingMode === 'auto') return {};
  if (runtime.thinkingMode === 'disabled') {
    return { thinking: { type: 'disabled' } };
  }
  return {
    thinking: { type: 'enabled' },
    reasoning_effort: reasoningEffort,
  };
}

export function resolveAiRuntimeEnv(
  viteEnv: AiRuntimeEnvSource = readImportMetaEnv(),
  processEnv: AiRuntimeEnvSource = readProcessEnv(),
): AiRuntimeEnv {
  return {
    apiKey: firstNonEmpty(
      viteEnv.VITE_API_KEY,
      viteEnv.VITE_OPENAI_API_KEY,
      viteEnv.VITE_GEMINI_API_KEY,
      processEnv.API_KEY,
      processEnv.OPENAI_API_KEY,
      processEnv.GEMINI_API_KEY,
    ),
    baseUrl:
      firstNonEmpty(viteEnv.VITE_OPENAI_BASE_URL, processEnv.OPENAI_BASE_URL) ||
      'https://api.openai.com/v1',
    model: firstNonEmpty(viteEnv.VITE_OPENAI_MODEL, processEnv.OPENAI_MODEL) || 'bce/deepseek-v3.2',
    contextWindowTokens: positiveInteger(
      firstNonEmpty(
        viteEnv.VITE_OPENAI_CONTEXT_WINDOW_TOKENS,
        processEnv.OPENAI_CONTEXT_WINDOW_TOKENS,
      ),
      32_768,
    ),
    thinkingMode: enumValue(
      firstNonEmpty(viteEnv.VITE_OPENAI_THINKING_MODE, processEnv.OPENAI_THINKING_MODE).toLowerCase(),
      ['auto', 'enabled', 'disabled'] as const,
      'auto',
    ),
    reasoningEffort: enumValue(
      firstNonEmpty(
        viteEnv.VITE_OPENAI_REASONING_EFFORT,
        processEnv.OPENAI_REASONING_EFFORT,
      ).toLowerCase(),
      ['low', 'medium', 'high', 'max'] as const,
      'high',
    ),
    backendUrl: firstNonEmpty(viteEnv.VITE_AI_BACKEND_URL, processEnv.AI_BACKEND_URL).replace(
      /\/+$/,
      '',
    ),
  };
}
