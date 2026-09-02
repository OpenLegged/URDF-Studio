import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'

import type { AgentSessionRecord } from '../persistence'
import {
  getAgentSessionRepository,
  subscribeAgentSessionStore,
} from '../services/agentSessionStore'
import type {
  AIConversationLaunchContext,
  AIConversationMessage,
} from '../types'
import {
  createAgentConversationSession,
  forkAgentConversationSession,
  persistConversationTimeline,
} from '../utils/conversationSessionPersistence'

interface UseConversationSessionPersistenceOptions {
  isOpen: boolean
  launchContext: AIConversationLaunchContext | null
  messages: AIConversationMessage[]
  setMessages: Dispatch<SetStateAction<AIConversationMessage[]>>
  resetConversationState: () => void
  onStartNewConversation: (launchContext: AIConversationLaunchContext) => void
}

interface ConversationSessionPersistenceController {
  isRestoringSession: boolean
  ensurePersistentSession: () => Promise<void>
  forkPersistentSession: (messages: AIConversationMessage[]) => Promise<void>
  clearPersistentSession: () => Promise<void>
}

async function startEmptySession(
  launchContext: AIConversationLaunchContext,
): Promise<{ session: AgentSessionRecord; messages: AIConversationMessage[] }> {
  const repository = await getAgentSessionRepository()
  const session = await createAgentConversationSession(
    repository,
    launchContext.mode,
  )
  return { session, messages: [] }
}

function queueTimelineSave(options: {
  queueRef: MutableRefObject<Promise<void>>
  sessionRef: MutableRefObject<AgentSessionRecord | null>
  sessionId: string
  messages: AIConversationMessage[]
}): void {
  options.queueRef.current = options.queueRef.current
    .catch(() => undefined)
    .then(async () => {
      const repository = await getAgentSessionRepository()
      const updatedSession = await persistConversationTimeline(
        repository,
        options.sessionId,
        options.messages,
      )
      if (options.sessionRef.current?.id === options.sessionId && updatedSession) {
        options.sessionRef.current = updatedSession
      }
    })
    .catch((error) => {
      console.error('Agent conversation save failed', error)
    })
}

export function useConversationSessionPersistence({
  isOpen,
  launchContext,
  messages,
  setMessages,
  resetConversationState,
  onStartNewConversation,
}: UseConversationSessionPersistenceOptions): ConversationSessionPersistenceController {
  const [isRestoringSession, setIsRestoringSession] = useState(false)
  const sessionRef = useRef<AgentSessionRecord | null>(null)
  const readyRef = useRef(false)
  const generationRef = useRef(0)
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve())
  const lastTimelineRef = useRef('[]')
  const skipNextLaunchResetRef = useRef(false)
  const isOpenRef = useRef(false)
  const initializedContextRef = useRef<AIConversationLaunchContext | null>(null)

  useEffect(() => {
    if (!isOpen) {
      if (!isOpenRef.current && initializedContextRef.current === null) return
      isOpenRef.current = false
      initializedContextRef.current = null
      generationRef.current += 1
      readyRef.current = false
      sessionRef.current = null
      lastTimelineRef.current = '[]'
      setIsRestoringSession(false)
      resetConversationState()
      return
    }
    if (!launchContext) return
    if (isOpenRef.current && initializedContextRef.current === launchContext) return

    isOpenRef.current = true
    initializedContextRef.current = launchContext
    if (skipNextLaunchResetRef.current) {
      skipNextLaunchResetRef.current = false
      return
    }

    const generation = generationRef.current + 1
    generationRef.current = generation
    readyRef.current = false
    sessionRef.current = null
    lastTimelineRef.current = '[]'
    setIsRestoringSession(true)
    resetConversationState()

    void startEmptySession(launchContext)
      .then(started => {
        if (generationRef.current !== generation) return
        sessionRef.current = started.session
        lastTimelineRef.current = '[]'
        setMessages([])
        readyRef.current = true
      })
      .catch(error => console.error('Agent conversation session start failed', error))
      .finally(() => {
        if (generationRef.current === generation) setIsRestoringSession(false)
      })
  }, [isOpen, launchContext, resetConversationState, setMessages])

  useEffect(() => {
    const serializedTimeline = JSON.stringify(messages)
    const sessionId = sessionRef.current?.id
    if (!readyRef.current || !sessionId || serializedTimeline === lastTimelineRef.current) return

    lastTimelineRef.current = serializedTimeline
    queueTimelineSave({
      queueRef: writeQueueRef,
      sessionRef,
      sessionId,
      messages,
    })
  }, [messages])

  useEffect(() => subscribeAgentSessionStore(change => {
    if (change !== 'cleared') return
    generationRef.current += 1
    readyRef.current = false
    sessionRef.current = null
    lastTimelineRef.current = '[]'
    setIsRestoringSession(false)
    resetConversationState()
  }), [resetConversationState])

  const ensurePersistentSession = useCallback(async () => {
    if (sessionRef.current || !launchContext) return
    try {
      const repository = await getAgentSessionRepository()
      sessionRef.current = await createAgentConversationSession(repository, launchContext.mode)
      readyRef.current = true
    } catch (error) {
      console.error('Agent conversation session creation failed', error)
    }
  }, [launchContext])

  const forkPersistentSession = useCallback(async (nextMessages: AIConversationMessage[]) => {
    if (!launchContext) return
    readyRef.current = false
    try {
      await writeQueueRef.current.catch(() => undefined)
      const repository = await getAgentSessionRepository()
      const activeSessionId = sessionRef.current?.id
      const parent = activeSessionId
        ? (await repository.loadSession(activeSessionId))?.session ?? null
        : null
      let child = parent
        ? await forkAgentConversationSession(
            repository,
            parent,
            nextMessages,
            launchContext.mode,
          )
        : await createAgentConversationSession(repository, launchContext.mode)
      if (!parent) {
        child = await persistConversationTimeline(
          repository,
          child.id,
          nextMessages,
        ) ?? child
      }
      sessionRef.current = child
      lastTimelineRef.current = JSON.stringify(nextMessages)
      readyRef.current = true
    } catch (error) {
      console.error('Agent conversation fork failed', error)
    } finally {
      skipNextLaunchResetRef.current = true
      onStartNewConversation(launchContext)
    }
  }, [launchContext, onStartNewConversation])

  const clearPersistentSession = useCallback(async () => {
    if (!launchContext) return
    readyRef.current = false
    try {
      await writeQueueRef.current.catch(() => undefined)
      const repository = await getAgentSessionRepository()
      const activeSessionId = sessionRef.current?.id
      if (activeSessionId) await repository.deleteSession(activeSessionId)
      sessionRef.current = await createAgentConversationSession(repository, launchContext.mode)
      lastTimelineRef.current = '[]'
      readyRef.current = true
    } catch (error) {
      console.error('Agent conversation clear failed', error)
    }
  }, [launchContext])

  return {
    isRestoringSession,
    ensurePersistentSession,
    forkPersistentSession,
    clearPersistentSession,
  }
}
