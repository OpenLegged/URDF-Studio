import type {
  StudioCommandContext,
  StudioCommandResult,
  StudioElementInteraction,
  StudioElementKind,
  StudioElementPage,
  StudioElementQuery,
  StudioElementSnapshot,
} from '@/features/ai-assistant'

const INTERACTIVE_SELECTOR = [
  'button',
  'input',
  'textarea',
  'select',
  'a[href]',
  'summary',
  '[contenteditable="true"]',
  '[role]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const STATUS_SELECTOR = [
  '[role="alert"]',
  '[role="status"]',
  '[aria-live]',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
].join(',')

const DEFAULT_ELEMENT_LIMIT = 20
const MAX_ELEMENT_LIMIT = 40
const MAX_TEXT_LENGTH = 160
const SENSITIVE_PATTERN = /(api.?key|access.?token|secret|password|credential|authorization)/i
const USER_ONLY_ACTION_PATTERN = /^(export|download|delete|remove|clear|reset|导出|下载|删除|移除|清空|重置)(\b|$)/i

function normalizeText(value: string | null | undefined): string {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim()
  return normalized.length > MAX_TEXT_LENGTH
    ? `${normalized.slice(0, MAX_TEXT_LENGTH - 1)}…`
    : normalized
}

function directText(element: Element): string {
  return normalizeText(Array.from(element.childNodes)
    .filter(node => node.nodeType === node.TEXT_NODE)
    .map(node => node.textContent ?? '')
    .join(' '))
}

function labelledByText(element: Element): string {
  const document = element.ownerDocument
  return normalizeText((element.getAttribute('aria-labelledby') ?? '')
    .split(/\s+/)
    .map(id => document.getElementById(id)?.textContent ?? '')
    .join(' '))
}

function controlLabel(element: Element): string {
  if (element.tagName !== 'INPUT' && element.tagName !== 'TEXTAREA' && element.tagName !== 'SELECT') {
    return ''
  }
  const labels = (element as HTMLInputElement).labels
  return normalizeText(labels ? Array.from(labels).map(label => label.textContent ?? '').join(' ') : '')
}

function inferRole(element: Element): string {
  const explicit = element.getAttribute('role')
  if (explicit) return explicit
  const tag = element.tagName.toLowerCase()
  if (tag === 'button') return 'button'
  if (tag === 'a') return 'link'
  if (tag === 'textarea') return 'textbox'
  if (tag === 'select') return 'combobox'
  if (tag === 'summary') return 'button'
  if (/^h[1-6]$/.test(tag)) return 'heading'
  if (tag === 'canvas') return 'canvas'
  if (tag === 'input') {
    const type = (element.getAttribute('type') ?? 'text').toLowerCase()
    if (type === 'checkbox') return 'checkbox'
    if (type === 'radio') return 'radio'
    if (type === 'range') return 'slider'
    if (type === 'button' || type === 'submit' || type === 'reset') return 'button'
    return 'textbox'
  }
  return 'generic'
}

function accessibleName(element: Element, kind: StudioElementKind): string {
  const explicit = normalizeText(element.getAttribute('aria-label'))
    || labelledByText(element)
    || controlLabel(element)
    || normalizeText(element.getAttribute('title'))
    || normalizeText(element.getAttribute('placeholder'))
    || normalizeText(element.getAttribute('alt'))
  if (explicit) return explicit
  if (kind === 'all' && inferRole(element) === 'generic') {
    return directText(element)
  }
  return normalizeText(element.textContent)
    || normalizeText(element.getAttribute('data-testid'))
    || normalizeText(element.id)
}

function isVisibleToAgent(element: Element): boolean {
  if (element.closest('[data-studio-agent-exclude="true"]')) return false
  if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false
  const view = element.ownerDocument.defaultView
  let current: Element | null = element
  while (current) {
    const style = view?.getComputedStyle(current)
    if (style?.display === 'none' || style?.visibility === 'hidden') return false
    current = current.parentElement
  }
  return true
}

function isSensitiveElement(element: Element): boolean {
  if (element.tagName === 'INPUT' && element.getAttribute('type')?.toLowerCase() === 'password') {
    return true
  }
  const identity = [
    element.id,
    element.getAttribute('name'),
    element.getAttribute('autocomplete'),
    element.getAttribute('aria-label'),
    element.getAttribute('placeholder'),
  ].filter(Boolean).join(' ')
  return SENSITIVE_PATTERN.test(identity)
}

function readElementValue(element: Element): string | undefined {
  if (isSensitiveElement(element)) return '[redacted]'
  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') {
    return normalizeText((element as HTMLInputElement).value)
  }
  if (element.getAttribute('contenteditable') === 'true') {
    return normalizeText(element.textContent)
  }
  return undefined
}

function isDisabled(element: Element): boolean {
  return element.getAttribute('aria-disabled') === 'true' || element.matches(':disabled')
}

function readOptions(element: Element): string[] | undefined {
  if (element.tagName !== 'SELECT') return undefined
  return Array.from((element as HTMLSelectElement).options)
    .slice(0, 20)
    .map(option => normalizeText(`${option.value}: ${option.text}`))
}

function selectorForKind(kind: StudioElementKind): string {
  if (kind === 'interactive') return INTERACTIVE_SELECTOR
  if (kind === 'status') return STATUS_SELECTOR
  return 'body *'
}

function matchesQuery(snapshot: StudioElementSnapshot, query: string): boolean {
  if (!query) return true
  const haystack = [
    snapshot.elementId,
    snapshot.tag,
    snapshot.role,
    snapshot.name,
    snapshot.testId,
    snapshot.placeholder,
    snapshot.value === '[redacted]' ? undefined : snapshot.value,
  ].filter(Boolean).join(' ').toLowerCase()
  return haystack.includes(query.toLowerCase())
}

function dispatchValueEvents(element: Element): void {
  const EventConstructor = element.ownerDocument.defaultView?.Event
  if (!EventConstructor) return
  element.dispatchEvent(new EventConstructor('input', { bubbles: true }))
  element.dispatchEvent(new EventConstructor('change', { bubbles: true }))
}

function setNativeValue(element: Element, value: string): boolean {
  const window = element.ownerDocument.defaultView
  if (!window) return false
  let prototype: object | null = null
  if (element.tagName === 'INPUT') prototype = window.HTMLInputElement.prototype
  if (element.tagName === 'TEXTAREA') prototype = window.HTMLTextAreaElement.prototype
  if (element.tagName === 'SELECT') prototype = window.HTMLSelectElement.prototype
  const setter = prototype && Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  if (!setter) return false
  setter.call(element, value)
  dispatchValueEvents(element)
  return true
}

function interactionBlocked(element: Element): string | null {
  if (isSensitiveElement(element)) return 'Sensitive credential fields are not available to the Agent.'
  if (element.tagName === 'INPUT' && element.getAttribute('type')?.toLowerCase() === 'file') {
    return 'File inputs require direct user interaction.'
  }
  if (isDisabled(element)) return 'The target element is disabled.'
  return null
}

function restrictedClickReason(element: Element): string | null {
  if (USER_ONLY_ACTION_PATTERN.test(accessibleName(element, 'interactive'))) {
    return 'Export, download, and destructive actions require the user.'
  }
  if (element.tagName === 'A') {
    const anchor = element as HTMLAnchorElement
    if (anchor.hasAttribute('download')) return 'Direct downloads require the user.'
    try {
      const target = new URL(anchor.href, element.ownerDocument.location.href)
      if (target.origin !== element.ownerDocument.location.origin) {
        return 'External navigation requires the user.'
      }
    } catch {
      return 'Invalid navigation target.'
    }
  }
  return null
}

interface StudioDomAgent {
  readElements: (query: StudioElementQuery, context: StudioCommandContext) => StudioElementPage
  interactWithElement: (
    interaction: StudioElementInteraction,
    context: StudioCommandContext,
  ) => StudioCommandResult
}

/** Session-scoped accessible DOM bridge. It never exposes raw HTML or CSS selectors to the model. */
export function createStudioDomAgent(document: Document = window.document): StudioDomAgent {
  const elementIds = new WeakMap<Element, string>()
  const elementsById = new Map<string, Element>()
  let nextElementId = 1

  const snapshotElement = (
    element: Element,
    kind: StudioElementKind,
  ): StudioElementSnapshot => {
    let elementId = elementIds.get(element)
    if (!elementId) {
      elementId = `ui-${nextElementId}`
      nextElementId += 1
      elementIds.set(element, elementId)
    }
    elementsById.set(elementId, element)
    const snapshot: StudioElementSnapshot = {
      elementId,
      tag: element.tagName.toLowerCase(),
      role: inferRole(element),
      name: accessibleName(element, kind),
    }
    const testId = element.getAttribute('data-testid')
    const placeholder = element.getAttribute('placeholder')
    const expanded = element.getAttribute('aria-expanded')
    const selected = element.getAttribute('aria-selected')
    if (testId) snapshot.testId = testId
    if (placeholder) snapshot.placeholder = normalizeText(placeholder)
    if (isDisabled(element)) snapshot.disabled = true
    if ('checked' in element && typeof (element as HTMLInputElement).checked === 'boolean') {
      snapshot.checked = (element as HTMLInputElement).checked
    }
    if (expanded === 'true' || expanded === 'false') snapshot.expanded = expanded === 'true'
    if (selected === 'true' || selected === 'false') snapshot.selected = selected === 'true'
    const value = readElementValue(element)
    if (value !== undefined) snapshot.value = value
    const options = readOptions(element)
    if (options) snapshot.options = options
    return snapshot
  }

  const readElements = (
    query: StudioElementQuery,
    context: StudioCommandContext,
  ): StudioElementPage => {
    if (context.signal?.aborted) return { elements: [], total: 0, nextCursor: null }
    const kind = query.kind ?? 'interactive'
    const cursor = Math.max(0, Math.floor(query.cursor ?? 0))
    const limit = Math.min(MAX_ELEMENT_LIMIT, Math.max(1, Math.floor(query.limit ?? DEFAULT_ELEMENT_LIMIT)))
    elementsById.clear()
    const snapshots = Array.from(document.querySelectorAll(selectorForKind(kind)))
      .filter(isVisibleToAgent)
      .map(element => snapshotElement(element, kind))
      .filter(snapshot => matchesQuery(snapshot, query.query?.trim() ?? ''))
    const elements = snapshots.slice(cursor, cursor + limit)
    const nextCursor = cursor + elements.length < snapshots.length
      ? cursor + elements.length
      : null
    return { elements, total: snapshots.length, nextCursor }
  }

  const interactWithElement = (
    interaction: StudioElementInteraction,
    context: StudioCommandContext,
  ): StudioCommandResult => {
    if (context.signal?.aborted) return { ok: false, message: 'The element action was cancelled.' }
    let elementId = interaction.elementId
    if (!elementId) {
      const query = interaction.query?.trim()
      if (!query) return { ok: false, message: 'Provide an elementId or accessible query.' }
      const page = readElements({ kind: 'interactive', query, limit: 2 }, context)
      if (page.total !== 1) {
        return {
          ok: false,
          message: page.total
            ? `Accessible query matched ${page.total} elements. Refine it or read elements first.`
            : 'Accessible query matched no interactive element.',
        }
      }
      elementId = page.elements[0]?.elementId
    }
    if (!elementId) return { ok: false, message: 'The requested element is unavailable.' }
    const element = elementsById.get(elementId)
    if (!element?.isConnected || !isVisibleToAgent(element)) {
      return { ok: false, message: 'Element is stale or unavailable. Read elements again.' }
    }
    const blockedReason = interactionBlocked(element)
    if (blockedReason) return { ok: false, message: blockedReason }
    if (interaction.operation === 'focus') {
      ;(element as HTMLElement).focus()
      return { ok: true, message: `${elementId} focused.` }
    }
    if (interaction.operation === 'click') {
      const restrictedReason = restrictedClickReason(element)
      if (restrictedReason) return { ok: false, message: restrictedReason }
      ;(element as HTMLElement).click()
      return { ok: true, message: `${elementId} clicked.` }
    }
    if (interaction.operation === 'toggle') {
      if (element.tagName !== 'INPUT' && !['checkbox', 'switch', 'radio'].includes(inferRole(element))) {
        return { ok: false, message: 'toggle requires a checkbox, radio, or switch.' }
      }
      ;(element as HTMLElement).click()
      return { ok: true, message: `${elementId} toggled.` }
    }
    if (interaction.operation === 'select-option' && element.tagName !== 'SELECT') {
      return { ok: false, message: 'select-option requires a select element.' }
    }
    if (interaction.operation === 'set-value' || interaction.operation === 'select-option') {
      if (interaction.value === undefined) return { ok: false, message: 'A value is required.' }
      if (
        interaction.operation === 'select-option'
        && !Array.from((element as HTMLSelectElement).options)
          .some(option => option.value === String(interaction.value))
      ) {
        return { ok: false, message: 'The requested option does not exist.' }
      }
      if (!setNativeValue(element, String(interaction.value))) {
        return { ok: false, message: 'This element does not accept a value.' }
      }
      return { ok: true, message: `${elementId} value updated.` }
    }
    return { ok: false, message: 'Unsupported element operation.' }
  }

  return { readElements, interactWithElement }
}
