/**
 * AI Service for robot generation, modification, and inspection
 */

import OpenAI from 'openai'
import type { RobotState, MotorSpec, InspectionReport } from '@/types'
import { translations, type Language } from '@/shared/i18n'
import { logRegressionError } from '@/shared/debug/consoleDiagnostics'
import type { AIResponse } from '../types'
import { getEasterEggResponse } from '../config/easterEggs'
import {
  INSPECTION_PROFILE_DEFINITIONS,
  getInspectionProfileLayerName,
} from '../config/inspectionProfiles'
import { getGenerationSystemPrompt, getInspectionSystemPrompt } from '../config/prompts'
import { buildInspectionPromptNotes } from '../utils/buildInspectionPromptNotes'
import { buildInspectionRobotContext } from '../utils/buildInspectionRobotContext'
import {
  buildInspectionEvidence,
  mergeInspectionEvidenceIntoReport,
} from '../utils/inspectionEvidence'
import { normalizeAIRobotResponse } from '../utils/normalizeRobotData'
import { processInspectionResults } from '../utils/processInspectionResults'
import type { SelectedInspectionProfileMap } from '../utils/inspectionProfileSelection'
import {
  isAiBackendAuthError,
  isAiBackendEnabled,
  requestAiBackendContent,
} from './aiBackendTransport'
import { buildAiThinkingRequestOptions, resolveAiRuntimeEnv } from './aiRuntimeEnv'

export type RobotInspectionStage =
  | 'preparing-context'
  | 'requesting-model'
  | 'processing-response'
  | 'finalizing-report'

interface RunRobotInspectionOptions {
  onStageChange?: (stage: RobotInspectionStage) => void
  signal?: AbortSignal
}

const getAiServiceTexts = (lang: Language) => {
  const t = translations[lang]
  return {
    apiKeyMissing: t.apiKeyMissing,
    loginRequired: t.aiLoginRequired,
    noContentFromApi: t.apiReturnedEmptyContent,
    rawResponse: t.rawResponse,
    jsonParseFailed: (message: string) =>
      t.failedToParseJson.replace('{message}', message || t.unknownError.toLowerCase()),
    unknown: t.unknown,
    suggestedMotorOptions: t.suggestedMotorOptions,
    generatedRobotSummary: (linkCount: number, jointCount: number) =>
      t.generatedRobotStructureSummary
        .replace('{linkCount}', String(linkCount))
        .replace('{jointCount}', String(jointCount)),
    modifiedRobotSummary: (linkCount: number, jointCount: number) =>
      t.modifiedRobotStructureSummary
        .replace('{linkCount}', String(linkCount))
        .replace('{jointCount}', String(jointCount)),
    processedRequestNoRobotData: t.processedRequestNoRobotData,
    apiCallFailed: (message?: string, status?: number) =>
      t.apiRequestFailed
        .replace('{message}', message || t.unknownError.toLowerCase())
        .replace('{statusSuffix}', status ? ` (${t.statusCodeLabel}: ${status})` : ''),
    configurationError: t.configurationError,
    inspectionError: t.inspectionError,
    parseError: t.parseError,
    failedToGetInspectionResponse: t.failedToGetInspectionResponse,
    failedToParseInspectionResults: t.failedToParseInspectionResults,
    failedToCompleteInspection: t.failedToCompleteInspection,
    inspectionEmptyContent: t.aiServiceReturnedEmptyContent,
    aiServiceRequestFailed: (message?: string) =>
      t.aiServiceCouldNotProcessRequest.replace('{message}', message || t.unknownError.toLowerCase()),
  }
}

/**
 * Create OpenAI client instance
 */
let openAIClientFactoryForTests: (() => OpenAI) | null = null

const createOpenAIClient = (): OpenAI => {
  if (openAIClientFactoryForTests) {
    return openAIClientFactoryForTests()
  }

  return new OpenAI({
    apiKey: resolveAiRuntimeEnv().apiKey,
    baseURL: resolveAiRuntimeEnv().baseUrl,
    dangerouslyAllowBrowser: true,
  })
}

export function __setInspectionOpenAIClientFactoryForTests(factory: (() => OpenAI) | null): void {
  openAIClientFactoryForTests = factory
}

/**
 * Get model name from environment
 */
const getModelName = (): string => {
  return resolveAiRuntimeEnv().model
}

interface GenerationContentRequest {
  useBackend: boolean
  prompt: string
  robot: unknown
  motorLibrary: unknown
  lang: Language
  signal?: AbortSignal
}

/**
 * Fetch the raw generation reply — backend proxy in managed mode, direct
 * OpenAI-compatible call in BYOK mode. Parsing stays with the caller so both
 * modes share one pipeline.
 */
const requestGenerationContent = async ({
  useBackend,
  prompt,
  robot,
  motorLibrary,
  lang,
  signal,
}: GenerationContentRequest): Promise<string | null | undefined> => {
  if (useBackend) {
    return requestAiBackendContent(
      '/generate',
      { prompt, robot, motorLibrary, lang },
      { signal },
    )
  }

  const openai = createOpenAIClient()
  const systemPrompt = getGenerationSystemPrompt({ robot, motorLibrary })
  const thinking = buildAiThinkingRequestOptions(resolveAiRuntimeEnv())
  const request = {
    model: getModelName(),
    messages: [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: prompt }
    ],
    response_format: {
      type: 'json_object' as const
    },
    ...(thinking.thinking?.type === 'enabled' ? {} : { temperature: 0.7 }),
    ...thinking,
  } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
  const response = await openai.chat.completions.create(
    request,
    { signal },
  )
  return response.choices[0]?.message?.content
}

interface InspectionContentRequest {
  useBackend: boolean
  robot: unknown
  criteriaDescription: string
  inspectionNotes: string
  lang: Language
  signal?: AbortSignal
}

/** Inspection counterpart of requestGenerationContent. */
const requestInspectionContent = async ({
  useBackend,
  robot,
  criteriaDescription,
  inspectionNotes,
  lang,
  signal,
}: InspectionContentRequest): Promise<string | null | undefined> => {
  if (useBackend) {
    return requestAiBackendContent(
      '/inspect',
      { robot, criteriaDescription, inspectionNotes, lang },
      { signal },
    )
  }

  const openai = createOpenAIClient()
  const systemPrompt = getInspectionSystemPrompt(lang, { criteriaDescription, inspectionNotes })
  const thinking = buildAiThinkingRequestOptions(resolveAiRuntimeEnv())
  const request = {
    model: getModelName(),
    messages: [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: `Inspect this robot structure:\n${JSON.stringify(robot)}` }
    ],
    response_format: {
      type: 'json_object' as const
    },
    ...(thinking.thinking?.type === 'enabled' ? {} : { temperature: 0.7 }),
    ...thinking,
  } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
  const response = await openai.chat.completions.create(
    request,
    {
      signal,
    },
  )
  return response.choices[0]?.message?.content
}

/**
 * Parse JSON from AI response with fallback strategies
 */
const parseJSONResponse = (content: string, lang: Language): { result: unknown; error?: string } => {
  const text = getAiServiceTexts(lang)
  try {
    return { result: JSON.parse(content) }
  } catch (parseError) {
    const jsonBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (jsonBlockMatch) {
      try {
        return { result: JSON.parse(jsonBlockMatch[1]) }
      } catch {
        // Continue to next fallback
      }
    }

    const firstOpen = content.indexOf('{')
    const lastClose = content.lastIndexOf('}')
    if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
      try {
        return { result: JSON.parse(content.substring(firstOpen, lastClose + 1)) }
      } catch {
        // Continue to error
      }
    }

    return {
      result: null,
      error: text.jsonParseFailed((parseError as Error)?.message || '')
    }
  }
}

const extractExplanationText = (parsedResult: Record<string, unknown>, lang: Language): string | undefined => {
  const text = getAiServiceTexts(lang)
  let explanationText = parsedResult.explanation as string | undefined
  if (!explanationText) {
    if (parsedResult.recommendation) {
      explanationText = parsedResult.recommendation as string
    } else if (parsedResult.analysis) {
      explanationText =
        typeof parsedResult.analysis === 'string'
          ? parsedResult.analysis
          : JSON.stringify(parsedResult.analysis)
    } else if (
      parsedResult.suggestions &&
      Array.isArray(parsedResult.suggestions) &&
      parsedResult.suggestions.length > 0
    ) {
      explanationText =
        `${text.suggestedMotorOptions}\n` +
        parsedResult.suggestions
          .map(
            (s: Record<string, unknown>, i: number) =>
              `${i + 1}. ${s.name || s.model || text.unknown}: ${s.torque || s.effort || 'N/A'} Nm`
          )
          .join('\n')
    }
  }

  return explanationText
}

const extractRobotData = (parsedResult: Record<string, unknown>): Record<string, unknown> | null => {
  return (parsedResult.robotData ||
    parsedResult.robot ||
    (parsedResult.links || parsedResult.joints ? parsedResult : null)) as Record<string, unknown> | null
}

export const buildInspectionCriteriaDescription = (
  selectedItems: SelectedInspectionProfileMap | undefined,
  lang: 'en' | 'zh'
): string => {
  return INSPECTION_PROFILE_DEFINITIONS.map(profile => {
    const selectedItemIds = selectedItems?.[profile.id] || []
    if (selectedItemIds.length === 0) return null

    const profileName = lang === 'zh' ? profile.nameZh : profile.name
    const profileDesc = lang === 'zh' ? profile.descriptionZh : profile.description
    const layerName = getInspectionProfileLayerName(profile.layer, lang)
    const itemsDesc = profile.items
      .filter(item => selectedItemIds.includes(item.id))
      .map(item => {
        const itemName = lang === 'zh' ? item.nameZh : item.name
        const itemDesc = lang === 'zh' ? item.descriptionZh : item.description
        const severityLabel =
          lang === 'zh'
            ? item.severityOnFailure === 'error'
              ? '错误'
              : item.severityOnFailure === 'warning'
                ? '警告'
                : '建议'
            : item.severityOnFailure
        const evidenceLabel = item.evidenceLevelRequired
          ? lang === 'zh'
            ? `，证据等级：${item.evidenceLevelRequired}`
            : `, evidence: ${item.evidenceLevelRequired}`
          : ''
        return lang === 'zh'
          ? `    - ${itemName} (${item.id})：${itemDesc} 失败等级：${severityLabel}${evidenceLabel}`
          : `    - ${itemName} (${item.id}): ${itemDesc} Failure severity: ${severityLabel}${evidenceLabel}`
      })
      .join('\n')

    if (itemsDesc) {
      return lang === 'zh'
        ? `  ${profile.id}（${profileName}，层级：${profile.layer} / ${layerName}）：${profileDesc}\n${itemsDesc}`
        : `  ${profile.id} (${profileName}, layer: ${profile.layer} / ${layerName}): ${profileDesc}\n${itemsDesc}`
    }
    return null
  })
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Generate or modify robot from natural language prompt
 */
interface GenerateRobotFromPromptRequest {
  prompt: string
  currentRobot: RobotState
  motorLibrary: Record<string, MotorSpec[]>
  lang: Language
  signal?: AbortSignal
}

const rethrowIfGenerationAborted = (signal: AbortSignal | undefined, error: unknown): void => {
  if (signal?.aborted) {
    throw error
  }
}

const generateRobotFromPromptRequest = async ({
  prompt,
  currentRobot,
  motorLibrary,
  lang,
  signal,
}: GenerateRobotFromPromptRequest
): Promise<AIResponse | null> => {
  const text = getAiServiceTexts(lang)
  const easterEggResponse = getEasterEggResponse(prompt)
  if (easterEggResponse) {
    return easterEggResponse
  }

  const useBackend = isAiBackendEnabled()
  const aiRuntimeEnv = resolveAiRuntimeEnv()
  if (!useBackend && !aiRuntimeEnv.apiKey) {
    logRegressionError('API Key missing')
    logRegressionError('Available env vars:', {
      API_KEY: 'missing',
      OPENAI_BASE_URL: aiRuntimeEnv.baseUrl,
      OPENAI_MODEL: aiRuntimeEnv.model
    })
    return {
      explanation: text.apiKeyMissing,
      actionType: 'advice'
    }
  }

  const contextRobot = {
    name: currentRobot.name,
    links: Object.values(currentRobot.links).map(l => ({
      id: l.id,
      name: l.name,
      visual: l.visual,
      inertial: l.inertial
    })),
    joints: Object.values(currentRobot.joints).map(j => ({
      id: j.id,
      name: j.name,
      type: j.type,
      parent: j.parentLinkId,
      child: j.childLinkId,
      origin: j.origin,
      axis: j.axis,
      limit: j.limit,
      hardware: j.hardware
    })),
    rootId: currentRobot.rootLinkId
  }

  const contextLibrary = Object.entries(motorLibrary).map(([brand, motors]) => ({
    brand,
    motors: motors.map(m => ({
      name: m.name,
      effort: m.effort,
      velocity: m.velocity,
      weight: m.armature
    }))
  }))

  try {
    const content = await requestGenerationContent({
      useBackend,
      prompt,
      robot: contextRobot,
      motorLibrary: contextLibrary,
      lang,
      signal,
    })

    if (!content) {
      logRegressionError('No content in API response')
      return {
        explanation: text.noContentFromApi,
        actionType: 'advice' as const
      }
    }

    const { result, error } = parseJSONResponse(content, lang)
    if (!result) {
      return {
        explanation: `${error}\n\n${text.rawResponse}: ${content.substring(0, 500)}`,
        actionType: 'advice' as const
      }
    }

    const parsedResult = result as Record<string, unknown>
    const data = extractRobotData(parsedResult)

    const explanationText = extractExplanationText(parsedResult, lang)

    let finalRobotState: Partial<RobotState> | undefined = undefined
    if (data) {
      const normalized = normalizeAIRobotResponse(data)
      if (normalized) {
        finalRobotState = {
          name: normalized.name,
          links: normalized.links,
          joints: normalized.joints,
          rootLinkId: normalized.rootLinkId as string
        }
      }
    }

    let actionType: 'modification' | 'generation' | 'advice' =
      (parsedResult.actionType as 'modification' | 'generation' | 'advice') || 'advice'
    if (finalRobotState && (finalRobotState.links || finalRobotState.joints)) {
      actionType =
        (parsedResult.actionType as 'modification' | 'generation' | 'advice') ||
        (Object.keys(currentRobot.links).length === 0 ? 'generation' : 'modification')
    }

    let explanation = explanationText
    if (!explanation) {
      if (finalRobotState) {
        const linkCount = Object.keys(finalRobotState.links || {}).length
        const jointCount = Object.keys(finalRobotState.joints || {}).length
        explanation =
          actionType === 'generation'
            ? text.generatedRobotSummary(linkCount, jointCount)
            : text.modifiedRobotSummary(linkCount, jointCount)
      } else {
        explanation = text.processedRequestNoRobotData
      }
    }

    return {
      explanation,
      actionType,
      robotData: finalRobotState
    }
  } catch (e: unknown) {
    rethrowIfGenerationAborted(signal, e)
    return mapGenerationFailure(e, text)
  }
}

export const generateRobotFromPrompt = (
  prompt: string,
  currentRobot: RobotState,
  motorLibrary: Record<string, MotorSpec[]>,
  lang: Language = 'en',
): Promise<AIResponse | null> => generateRobotFromPromptRequest({
  prompt,
  currentRobot,
  motorLibrary,
  lang,
})

export const generateRobotFromPromptWithOptions = (
  request: GenerateRobotFromPromptRequest,
): Promise<AIResponse | null> => generateRobotFromPromptRequest(request)

const mapGenerationFailure = (
  e: unknown,
  text: ReturnType<typeof getAiServiceTexts>,
): AIResponse => {
  if (isAiBackendAuthError(e)) {
    return {
      explanation: text.loginRequired,
      actionType: 'advice' as const
    }
  }

  const error = e as { message?: string; status?: number; code?: string; response?: unknown }
  logRegressionError('OpenAI API call failed', e)
  logRegressionError('Error details:', {
    message: error?.message,
    status: error?.status,
    code: error?.code,
    response: error?.response
  })

  return {
    explanation: text.apiCallFailed(error?.message, error?.status),
    actionType: 'advice' as const
  }
}

/**
 * Run robot inspection with AI
 */
export const runRobotInspection = async (
  robot: RobotState,
  selectedItems?: SelectedInspectionProfileMap,
  lang: Language = 'en',
  options: RunRobotInspectionOptions = {},
): Promise<InspectionReport | null> => {
  const text = getAiServiceTexts(lang)
  const useBackend = isAiBackendEnabled()
  if (!useBackend && !resolveAiRuntimeEnv().apiKey) {
    logRegressionError('API Key missing')
    return {
      summary: text.apiKeyMissing,
      issues: [
        {
          type: 'error',
          title: text.configurationError,
          description: text.apiKeyMissing,
          profileId: 'unmapped',
          itemId: 'unmapped',
          score: 0,
        }
      ]
    }
  }

  options.onStageChange?.('preparing-context')
  const contextRobot = buildInspectionRobotContext(robot)
  const localEvidence = buildInspectionEvidence(robot)

  const criteriaDescription = buildInspectionCriteriaDescription(selectedItems, lang)
  const inspectionNotes = buildInspectionPromptNotes(robot, selectedItems, lang)

  try {
    options.onStageChange?.('requesting-model')
    const content = await requestInspectionContent({
      useBackend,
      robot: contextRobot,
      criteriaDescription,
      inspectionNotes,
      lang,
      signal: options.signal,
    })

    if (!content) {
      return {
        summary: text.failedToGetInspectionResponse,
        issues: [
          {
            type: 'error',
            title: text.inspectionError,
            description: text.inspectionEmptyContent,
            profileId: 'unmapped',
            itemId: 'unmapped',
            score: 0,
          }
        ]
      }
    }

    options.onStageChange?.('processing-response')
    const { result, error } = parseJSONResponse(content, lang)
    if (!result) {
      return {
        summary: text.failedToParseInspectionResults,
        issues: [
          {
            type: 'error',
            title: text.parseError,
            description: `${error}\n\n${text.rawResponse}: ${content.substring(0, 500)}`,
            profileId: 'unmapped',
            itemId: 'unmapped',
            score: 0,
          }
        ]
      }
    }

    options.onStageChange?.('finalizing-report')
    return mergeInspectionEvidenceIntoReport(
      processInspectionResults(result, selectedItems, lang),
      localEvidence,
      lang,
      selectedItems,
    )
  } catch (e: unknown) {
    return mapInspectionFailure(e, options.signal, text)
  }
}

const mapInspectionFailure = (
  e: unknown,
  signal: AbortSignal | undefined,
  text: ReturnType<typeof getAiServiceTexts>,
): InspectionReport | null => {
  if (
    signal?.aborted ||
    e instanceof OpenAI.APIUserAbortError ||
    (e instanceof Error && e.name === 'AbortError')
  ) {
    return null
  }

  if (isAiBackendAuthError(e)) {
    return {
      summary: text.loginRequired,
      issues: [
        {
          type: 'error',
          title: text.configurationError,
          description: text.loginRequired,
          profileId: 'unmapped',
          itemId: 'unmapped',
          score: 0,
        }
      ]
    }
  }

  const error = e as { message?: string }
  logRegressionError('Inspection failed', e)
  return {
    summary: text.failedToCompleteInspection,
    issues: [
      {
        type: 'error',
        title: text.inspectionError,
        description: text.aiServiceRequestFailed(error?.message),
        profileId: 'unmapped',
        itemId: 'unmapped',
        score: 0,
      }
    ]
  }
}
