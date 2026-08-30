import type OpenAI from 'openai'

type AgentMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam
type AgentToolSchema = {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export type AgentTokenEstimator = (text: string) => number

export interface AgentConversationTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface AgentContextBudgetOptions {
  contextWindowTokens?: number
  thresholdRatio?: number
  retainRatio?: number
  summaryTokenLimit?: number
  toolResultTokenLimit?: number
  tokenEstimator?: AgentTokenEstimator
}

export interface ResolvedAgentContextBudget {
  contextWindowTokens: number
  thresholdTokens: number
  retainTokens: number
  summaryTokenLimit: number
  toolResultTokenLimit: number
  tokenEstimator: AgentTokenEstimator
}

export interface ContextCompactionPreparation {
  beforeTokens: number
  afterPruningTokens: number
  messages: AgentMessage[]
  prefixEndIndex: number | null
  prunedToolResults: number
}

const DEFAULT_CONTEXT_WINDOW_TOKENS = 32_768
const DEFAULT_THRESHOLD_RATIO = 0.8
const DEFAULT_RETAIN_RATIO = 0.16
const DEFAULT_SUMMARY_TOKEN_LIMIT = 1_024
const DEFAULT_TOOL_RESULT_TOKEN_LIMIT = 2_048
const REQUEST_OVERHEAD_TOKENS = 16
const MIN_RECENT_UNITS = 2

/** Conservative browser-safe token estimate: UTF-8 bytes / 3. */
export function estimateAgentTextTokens(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(new TextEncoder().encode(text).byteLength / 3))
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback
}

function boundedRatio(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1
    ? value
    : fallback
}

export function resolveAgentContextBudget(
  options: AgentContextBudgetOptions = {},
): ResolvedAgentContextBudget {
  const contextWindowTokens = positiveInteger(
    options.contextWindowTokens,
    DEFAULT_CONTEXT_WINDOW_TOKENS,
  )
  const thresholdRatio = boundedRatio(options.thresholdRatio, DEFAULT_THRESHOLD_RATIO)
  const retainRatio = boundedRatio(options.retainRatio, DEFAULT_RETAIN_RATIO)
  return {
    contextWindowTokens,
    thresholdTokens: Math.max(1, Math.floor(contextWindowTokens * thresholdRatio)),
    retainTokens: Math.max(1, Math.floor(contextWindowTokens * retainRatio)),
    summaryTokenLimit: positiveInteger(options.summaryTokenLimit, DEFAULT_SUMMARY_TOKEN_LIMIT),
    toolResultTokenLimit: positiveInteger(
      options.toolResultTokenLimit,
      DEFAULT_TOOL_RESULT_TOKEN_LIMIT,
    ),
    tokenEstimator: options.tokenEstimator ?? estimateAgentTextTokens,
  }
}

function serializeForMeter(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return String(value)
  }
}

export function estimateAgentRequestTokens(
  messages: AgentMessage[],
  tools: AgentToolSchema[],
  estimator: AgentTokenEstimator = estimateAgentTextTokens,
): number {
  return REQUEST_OVERHEAD_TOKENS + estimator(serializeForMeter({ messages, tools }))
}

function takeTextWithinBudget(
  text: string,
  tokenBudget: number,
  estimator: AgentTokenEstimator,
  fromEnd: boolean,
): string {
  let low = 0
  let high = text.length
  while (low < high) {
    const length = Math.ceil((low + high) / 2)
    const candidate = fromEnd ? text.slice(text.length - length) : text.slice(0, length)
    if (estimator(candidate) <= tokenBudget) {
      low = length
    } else {
      high = length - 1
    }
  }
  return fromEnd ? text.slice(text.length - low) : text.slice(0, low)
}

export function clipAgentTextToTokens(
  text: string,
  tokenBudget: number,
  estimator: AgentTokenEstimator = estimateAgentTextTokens,
): string {
  if (estimator(text) <= tokenBudget) return text
  const marker = '\n\n[... context compacted ...]\n\n'
  const markerTokens = estimator(marker)
  const availableTokens = Math.max(2, tokenBudget - markerTokens)
  const headBudget = Math.max(1, Math.floor(availableTokens * 0.75))
  const tailBudget = Math.max(1, availableTokens - headBudget)
  const head = takeTextWithinBudget(text, headBudget, estimator, false)
  const tail = takeTextWithinBudget(text, tailBudget, estimator, true)
  return `${head}${marker}${tail}`
}

function messageTextContent(message: AgentMessage): string | null {
  if (!('content' in message)) return null
  return typeof message.content === 'string'
    ? message.content
    : message.content === null || message.content === undefined
      ? null
      : serializeForMeter(message.content)
}

function pruneToolResults(
  messages: AgentMessage[],
  budget: ResolvedAgentContextBudget,
): { messages: AgentMessage[]; prunedToolResults: number } {
  let prunedToolResults = 0
  const nextMessages = messages.map(message => {
    if (message.role !== 'tool') return message
    const content = messageTextContent(message)
    if (!content || budget.tokenEstimator(content) <= budget.toolResultTokenLimit) {
      return message
    }
    prunedToolResults += 1
    return {
      ...message,
      content: clipAgentTextToTokens(
        content,
        budget.toolResultTokenLimit,
        budget.tokenEstimator,
      ),
    }
  })
  return { messages: nextMessages, prunedToolResults }
}

interface MessageUnit {
  start: number
  end: number
  tokens: number
}

function buildMessageUnits(
  messages: AgentMessage[],
  estimator: AgentTokenEstimator,
): MessageUnit[] {
  const units: MessageUnit[] = []
  let index = 1
  while (index < messages.length) {
    const start = index
    const message = messages[index]
    index += 1
    if (message?.role === 'assistant' && message.tool_calls?.length) {
      while (index < messages.length && messages[index]?.role === 'tool') {
        index += 1
      }
    }
    units.push({
      start,
      end: index,
      tokens: estimator(serializeForMeter(messages.slice(start, index))),
    })
  }
  return units
}

function chooseSummaryPrefixEnd(
  messages: AgentMessage[],
  budget: ResolvedAgentContextBudget,
): number | null {
  const units = buildMessageUnits(messages, budget.tokenEstimator)
  if (units.length < 2) return null
  let retainedTokens = 0
  let retainedUnits = 0
  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index]
    if (!unit) continue
    const mustRetain = retainedUnits < MIN_RECENT_UNITS
    if (!mustRetain && retainedTokens + unit.tokens > budget.retainTokens) break
    retainedTokens += unit.tokens
    retainedUnits += 1
  }
  if (retainedUnits >= units.length) {
    retainedUnits = 1
  }
  return units[units.length - retainedUnits]?.start ?? null
}

export function prepareAgentContextCompaction(
  messages: AgentMessage[],
  tools: AgentToolSchema[],
  budget: ResolvedAgentContextBudget,
  force = false,
  maxSummaryPrefixEndIndex?: number,
): ContextCompactionPreparation | null {
  const beforeTokens = estimateAgentRequestTokens(messages, tools, budget.tokenEstimator)
  if (!force && beforeTokens < budget.thresholdTokens) return null
  const pruned = pruneToolResults(messages, budget)
  const afterPruningTokens = estimateAgentRequestTokens(
    pruned.messages,
    tools,
    budget.tokenEstimator,
  )
  const needsSummary = force || afterPruningTokens >= budget.thresholdTokens
  const candidatePrefixEnd = needsSummary
    ? chooseSummaryPrefixEnd(pruned.messages, budget)
    : null
  const boundedPrefixEnd = candidatePrefixEnd === null
    ? null
    : Math.min(candidatePrefixEnd, maxSummaryPrefixEndIndex ?? candidatePrefixEnd)
  return {
    beforeTokens,
    afterPruningTokens,
    messages: pruned.messages,
    prefixEndIndex: boundedPrefixEnd !== null && boundedPrefixEnd > 1
      ? boundedPrefixEnd
      : null,
    prunedToolResults: pruned.prunedToolResults,
  }
}

function formatSummaryMessage(message: AgentMessage): string {
  const content = messageTextContent(message)
  if (message.role === 'assistant' && message.tool_calls?.length) {
    const calls = message.tool_calls.map(call => ({
      name: call.function.name,
      arguments: call.function.arguments,
    }))
    return `assistant tool calls: ${serializeForMeter(calls)}${content ? `\nassistant note: ${content}` : ''}`
  }
  return `${message.role}: ${content ?? serializeForMeter(message)}`
}

export function renderAgentSummarySource(
  messages: AgentMessage[],
  tokenBudget: number,
  estimator: AgentTokenEstimator,
): string {
  const source = messages.map(formatSummaryMessage).join('\n\n')
  return clipAgentTextToTokens(source, tokenBudget, estimator)
}

export function buildExtractiveAgentSummary(
  messages: AgentMessage[],
  tokenBudget: number,
  estimator: AgentTokenEstimator,
): string {
  const lines = messages.map(message => `- ${formatSummaryMessage(message)}`).join('\n')
  return clipAgentTextToTokens(lines, tokenBudget, estimator)
}

export function replaceAgentContextPrefix(
  messages: AgentMessage[],
  prefixEndIndex: number,
  summary: string,
): AgentMessage[] {
  const checkpoint = {
    role: 'user' as const,
    content:
      'This is an automatically generated checkpoint of earlier conversation context. '
      + 'Treat it as established background and continue from the messages that follow.\n\n'
      + `<compacted-summary>\n${summary.trim()}\n</compacted-summary>`,
  }
  return [messages[0]!, checkpoint, ...messages.slice(prefixEndIndex)]
}

export function buildAgentHistoryCheckpoint(messages: AgentMessage[]): AgentConversationTurn[] {
  const turns: AgentConversationTurn[] = []
  for (const message of messages.slice(1)) {
    if (message.role !== 'user' && message.role !== 'assistant') continue
    if (message.role === 'assistant' && message.tool_calls?.length) continue
    const content = messageTextContent(message)?.trim()
    if (content) turns.push({ role: message.role, content })
  }
  return turns
}
