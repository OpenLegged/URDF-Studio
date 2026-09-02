import OpenAI from 'openai';
import { translations, type Language } from '@/shared/i18n';
import { getConversationSystemPrompt, type ConversationMode } from '../config/prompts';
import {
  isAiBackendAuthError,
  isAiBackendEnabled,
  streamAiBackendChat,
} from './aiBackendTransport';
import { buildAiThinkingRequestOptions, resolveAiRuntimeEnv } from './aiRuntimeEnv';

export interface ConversationHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface SendConversationTurnInput {
  mode: ConversationMode;
  lang?: Language;
  context: string;
  history?: ConversationHistoryTurn[];
  userMessage: string;
}

export interface SendConversationTurnStreamInput extends SendConversationTurnInput {
  signal?: AbortSignal;
  onReplyDelta?: (delta: string) => void;
}

export type ConversationTurnErrorCode =
  | 'empty_user_message'
  | 'missing_api_key'
  | 'login_required'
  | 'empty_response'
  | 'request_failed';

export interface ConversationTurnError {
  code: ConversationTurnErrorCode;
  message: string;
}

export interface ConversationTurnResult {
  reply: string;
  error: ConversationTurnError | null;
}

export interface ConversationTurnStreamResult extends ConversationTurnResult {
  status: 'completed' | 'aborted' | 'error';
}

interface ConversationStreamChunkLike {
  choices?: Array<{
    delta?: {
      content?: string | null;
    };
  }>;
}

const MAX_HISTORY_TURNS = 8;

const getApiKey = (): string => {
  return resolveAiRuntimeEnv().apiKey;
};

const getBaseUrl = (): string => {
  return resolveAiRuntimeEnv().baseUrl;
};

const createOpenAIClient = (apiKey: string): OpenAI => {
  return new OpenAI({
    apiKey,
    baseURL: getBaseUrl(),
    dangerouslyAllowBrowser: true,
  });
};

const getModelName = (): string => {
  return resolveAiRuntimeEnv().model;
};

const getConversationTexts = (lang: Language) => {
  const t = translations[lang];
  return {
    missingApiKey: t.apiKeyMissing,
    loginRequired: t.aiLoginRequired,
    emptyResponse: t.aiServiceReturnedEmptyContent,
    unknownError: t.unknownError,
    requestFailed: (message?: string) =>
      t.aiServiceCouldNotProcessRequest.replace(
        '{message}',
        message || t.unknownError.toLowerCase(),
      ),
  };
};

const sanitizeHistoryTurn = (turn: ConversationHistoryTurn): ConversationHistoryTurn | null => {
  if (!turn.content) return null;
  const content = turn.content.trim();
  if (!content) return null;
  if (turn.role !== 'user' && turn.role !== 'assistant') return null;
  return {
    role: turn.role,
    content,
  };
};

export const buildConversationMessages = (
  history: ConversationHistoryTurn[] | undefined,
  userMessage: string,
): Array<{ role: 'user' | 'assistant'; content: string }> => {
  const normalizedHistory = (history || [])
    .map(sanitizeHistoryTurn)
    .filter((turn): turn is ConversationHistoryTurn => Boolean(turn))
    .slice(-MAX_HISTORY_TURNS);

  const normalizedUserMessage = userMessage.trim();
  const messages = normalizedHistory.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));

  messages.push({
    role: 'user',
    content: normalizedUserMessage,
  });

  return messages;
};

export const serializeConversationHistory = (
  history: ConversationHistoryTurn[] | undefined,
): string => {
  const normalizedHistory = (history || [])
    .map(sanitizeHistoryTurn)
    .filter((turn): turn is ConversationHistoryTurn => Boolean(turn))
    .slice(-MAX_HISTORY_TURNS);

  return JSON.stringify(normalizedHistory);
};

const buildConversationError = (
  code: ConversationTurnErrorCode,
  message: string,
): ConversationTurnError => ({
  code,
  message,
});

export const isConversationAbortError = (error: unknown): boolean => {
  return (
    error instanceof OpenAI.APIUserAbortError ||
    (error instanceof Error && error.name === 'AbortError')
  );
};

export const extractConversationDelta = (
  chunk: ConversationStreamChunkLike | null | undefined,
): string => {
  if (!chunk?.choices?.length) {
    return '';
  }

  return chunk.choices.map((choice) => choice.delta?.content ?? '').join('');
};

export const sendConversationTurnStream = async ({
  mode,
  lang = 'en',
  context,
  history = [],
  userMessage,
  signal,
  onReplyDelta,
}: SendConversationTurnStreamInput): Promise<ConversationTurnStreamResult> => {
  const text = getConversationTexts(lang);
  const trimmedMessage = userMessage.trim();

  if (!trimmedMessage) {
    return {
      reply: '',
      error: buildConversationError('empty_user_message', text.emptyResponse),
      status: 'error',
    };
  }

  if (isAiBackendEnabled()) {
    try {
      const result = await streamAiBackendChat(
        {
          mode,
          lang,
          context,
          history: (history || [])
            .map(sanitizeHistoryTurn)
            .filter((turn): turn is ConversationHistoryTurn => Boolean(turn))
            .slice(-MAX_HISTORY_TURNS),
          userMessage: trimmedMessage,
        },
        { signal, onDelta: onReplyDelta },
      );

      const normalizedReply = result.reply.trim();
      if (result.status === 'aborted') {
        return { reply: normalizedReply, error: null, status: 'aborted' };
      }
      if (!normalizedReply) {
        return {
          reply: '',
          error: buildConversationError('empty_response', text.emptyResponse),
          status: 'error',
        };
      }
      return { reply: normalizedReply, error: null, status: 'completed' };
    } catch (error) {
      if (isConversationAbortError(error) || signal?.aborted) {
        return { reply: '', error: null, status: 'aborted' };
      }
      if (isAiBackendAuthError(error)) {
        return {
          reply: '',
          error: buildConversationError('login_required', text.loginRequired),
          status: 'error',
        };
      }
      const e = error as { message?: string };
      console.error('Conversation request failed', error);
      return {
        reply: '',
        error: buildConversationError('request_failed', text.requestFailed(e?.message)),
        status: 'error',
      };
    }
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      reply: '',
      error: buildConversationError('missing_api_key', text.missingApiKey),
      status: 'error',
    };
  }

  const systemPrompt = getConversationSystemPrompt(lang, {
    mode,
    context,
    // Conversation history already goes into `messages`; keep the prompt copy empty
    // so we do not pay for the same turns twice.
    history: '',
  });

  const openai = createOpenAIClient(apiKey);
  const modelName = getModelName();
  const thinking = buildAiThinkingRequestOptions(resolveAiRuntimeEnv());
  const messages = buildConversationMessages(history, trimmedMessage);
  const requestMessages = [{ role: 'system' as const, content: systemPrompt }, ...messages];
  let reply = '';

  try {
    const request = {
      model: modelName,
      messages: requestMessages,
      stream: true as const,
      ...(thinking.thinking?.type === 'enabled' ? {} : { temperature: 0.3 }),
      ...thinking,
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming;
    const stream = await openai.chat.completions.create(
      request,
      {
        signal,
      },
    );

    for await (const chunk of stream) {
      const delta = extractConversationDelta(chunk);
      if (!delta) {
        continue;
      }

      reply += delta;
      onReplyDelta?.(delta);
    }

    const normalizedReply = reply.trim();
    if (!normalizedReply) {
      return {
        reply: '',
        error: buildConversationError('empty_response', text.emptyResponse),
        status: 'error',
      };
    }

    return {
      reply: normalizedReply,
      error: null,
      status: 'completed',
    };
  } catch (error) {
    if (isConversationAbortError(error) || signal?.aborted) {
      return {
        reply: reply.trim(),
        error: null,
        status: 'aborted',
      };
    }

    const e = error as { message?: string };
    console.error('Conversation request failed', error);
    return {
      reply: '',
      error: buildConversationError('request_failed', text.requestFailed(e?.message)),
      status: 'error',
    };
  }
};

export const sendConversationTurn = async (
  input: SendConversationTurnInput,
): Promise<ConversationTurnResult> => {
  const result = await sendConversationTurnStream(input);
  return {
    reply: result.reply,
    error: result.error,
  };
};
