import { contextReferenceTypeFrom, type ContextReferenceType } from './types'

export const CURRENT_PAGE_CONTEXT_PHRASE = 'use current page as context'

/** Composer @-mention kinds: record context pins vs chat-native agent branches. */
export type ComposerMentionKind = 'context' | 'agent'

export interface ActiveContextMention {
  token: string
  namespace: string
  /** Record context type, or the agent branch namespace. */
  type: ContextReferenceType | 'agent'
  kind: ComposerMentionKind
  query: string
  start: number
  end: number
}

export interface ActiveContextTypePrompt {
  token: string
  query: string
  start: number
  end: number
}

export interface ContextReferenceMentionOption {
  type: ContextReferenceType | 'agent'
  namespace: string
  label: string
  kind: ComposerMentionKind
}

/** Chat-native @agent: branches — first in the bare-@ type list so specialists are discoverable. */
export const AGENT_MENTION_OPTION: ContextReferenceMentionOption = {
  type: 'agent',
  namespace: 'agent',
  label: 'Agents',
  kind: 'agent',
}

export const CONTEXT_REFERENCE_MENTION_OPTIONS: ContextReferenceMentionOption[] = [
  { type: 'project', namespace: 'projects', label: 'Projects', kind: 'context' },
  { type: 'task', namespace: 'tasks', label: 'Tasks', kind: 'context' },
  { type: 'contact', namespace: 'contacts', label: 'Contacts', kind: 'context' },
  { type: 'company', namespace: 'businesses', label: 'Businesses', kind: 'context' },
  { type: 'product', namespace: 'products', label: 'Products', kind: 'context' },
  { type: 'document', namespace: 'docs', label: 'Docs', kind: 'context' },
  { type: 'research', namespace: 'research', label: 'Research', kind: 'context' },
  { type: 'social', namespace: 'social', label: 'Social', kind: 'context' },
  { type: 'campaign', namespace: 'campaigns', label: 'Campaigns', kind: 'context' },
  { type: 'email', namespace: 'emails', label: 'Emails', kind: 'context' },
  { type: 'support', namespace: 'support', label: 'Support', kind: 'context' },
  { type: 'deal', namespace: 'deals', label: 'Deals', kind: 'context' },
  { type: 'invoice', namespace: 'invoices', label: 'Invoices', kind: 'context' },
  { type: 'quote', namespace: 'quotes', label: 'Quotes', kind: 'context' },
  { type: 'property', namespace: 'properties', label: 'Properties', kind: 'context' },
  { type: 'seo_sprint', namespace: 'seosprints', label: 'SEO sprints', kind: 'context' },
  { type: 'workspace_folder', namespace: 'workspacefolders', label: 'Workspace folders', kind: 'context' },
  { type: 'workspace_artifact', namespace: 'workspaceartifacts', label: 'Workspace artifacts', kind: 'context' },
  { type: 'workspace_connection', namespace: 'workspaceconnections', label: 'Workspace connections', kind: 'context' },
  { type: 'workspace_broker_job', namespace: 'brokerjobs', label: 'Workspace broker jobs', kind: 'context' },
  { type: 'studio', namespace: 'studios', label: 'Studios', kind: 'context' },
  { type: 'studio_artifact', namespace: 'studioartifacts', label: 'Studio artifacts', kind: 'context' },
  { type: 'file', namespace: 'uploads', label: 'Uploaded files', kind: 'context' },
  { type: 'report', namespace: 'reports', label: 'Reports', kind: 'context' },
  { type: 'calendar_event', namespace: 'events', label: 'Calendar events', kind: 'context' },
]

const WORKBENCH_CONTEXT_REFERENCE_MENTION_OPTIONS: ContextReferenceMentionOption[] = [
  { type: 'workspace_folder', namespace: 'folders', label: 'Linked folders', kind: 'context' },
  { type: 'file', namespace: 'files', label: 'Linked files', kind: 'context' },
]

export function filterContextReferenceMentionOptions(
  query: string,
  options: { includeWorkbenchPaths?: boolean; includeAgents?: boolean } = {},
): ContextReferenceMentionOption[] {
  const normalized = query.trim().toLowerCase()
  const includeAgents = options.includeAgents !== false
  const contextOptions = options.includeWorkbenchPaths
    ? [...WORKBENCH_CONTEXT_REFERENCE_MENTION_OPTIONS, ...CONTEXT_REFERENCE_MENTION_OPTIONS]
    : CONTEXT_REFERENCE_MENTION_OPTIONS
  const available = includeAgents
    ? [AGENT_MENTION_OPTION, ...contextOptions]
    : contextOptions
  if (!normalized) return available
  return available.filter((option) => (
    option.namespace.includes(normalized) ||
    option.type.includes(normalized) ||
    option.label.toLowerCase().includes(normalized)
  ))
}

export function contextTypeFromMentionNamespace(namespace: string) {
  return contextReferenceTypeFrom(namespace)
}

export function isAgentMentionNamespace(namespace: string): boolean {
  const n = namespace.trim().toLowerCase()
  return n === 'agent' || n === 'agents'
}

export function extractCurrentPageContextCommand(input: string): { shouldUseCurrentPage: boolean; content: string } {
  const phraseRe = new RegExp(CURRENT_PAGE_CONTEXT_PHRASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig')
  const shouldUseCurrentPage = phraseRe.test(input)
  if (!shouldUseCurrentPage) return { shouldUseCurrentPage: false, content: input.trim() }
  phraseRe.lastIndex = 0
  const content = input.replace(phraseRe, '').replace(/\s+/g, ' ').trim()
  return { shouldUseCurrentPage: true, content }
}

export function findActiveContextMention(input: string, caretIndex = input.length): ActiveContextMention | null {
  const beforeCaret = input.slice(0, caretIndex)
  const match = /(^|\s)@([a-zA-Z]+):([^\s@]*)$/.exec(beforeCaret)
  if (!match) return null
  const rawNamespace = match[2]
  const namespace = rawNamespace.toLowerCase()
  const token = `@${rawNamespace}:${match[3] ?? ''}`
  const start = beforeCaret.length - token.length
  // Chat-native agent branches use @agent:<id> (also accept @agents: for type-picker UX).
  if (isAgentMentionNamespace(namespace)) {
    return {
      token,
      namespace: 'agent',
      type: 'agent',
      kind: 'agent',
      query: match[3] ?? '',
      start,
      end: caretIndex,
    }
  }
  const type = contextTypeFromMentionNamespace(namespace)
  if (!type) return null
  return {
    token,
    namespace,
    type,
    kind: 'context',
    query: match[3] ?? '',
    start,
    end: caretIndex,
  }
}

/** Complete an in-progress @agent: query to a sendable @agent:<id> token. */
export function completeAgentMentionToken(
  input: string,
  mention: Pick<ActiveContextMention, 'start' | 'end'>,
  agentId: string,
): { value: string; caret: number } {
  const id = agentId.trim()
  const token = `@agent:${id}`
  const needsTrailingSpace = mention.end >= input.length || !/\s/.test(input[mention.end] ?? '')
  const insertion = needsTrailingSpace ? `${token} ` : token
  const value = `${input.slice(0, mention.start)}${insertion}${input.slice(mention.end)}`
  return { value, caret: mention.start + insertion.length }
}

export function findActiveContextTypePrompt(input: string, caretIndex = input.length): ActiveContextTypePrompt | null {
  if (findActiveContextMention(input, caretIndex)) return null
  const beforeCaret = input.slice(0, caretIndex)
  const match = /(^|\s)@([a-zA-Z]*)$/.exec(beforeCaret)
  if (!match) return null
  const token = `@${match[2] ?? ''}`
  const start = beforeCaret.length - token.length
  return {
    token,
    query: (match[2] ?? '').toLowerCase(),
    start,
    end: caretIndex,
  }
}

export function removeMentionToken(
  input: string,
  mention: Pick<ActiveContextMention, 'start' | 'end'>,
  insertedSeparatorIndex?: number | null,
): string {
  const removeFrom = insertedSeparatorIndex === undefined
    ? (mention.start > 0 && input[mention.start - 1] === ' ' ? mention.start - 1 : mention.start)
    : insertedSeparatorIndex === mention.start - 1 && input[insertedSeparatorIndex] === ' '
      ? insertedSeparatorIndex
      : mention.start
  return `${input.slice(0, removeFrom)}${input.slice(mention.end)}`
}

export function removeMentionTokenFromLatest(
  latestInput: string,
  inputAtSelection: string,
  mention: ActiveContextMention,
  insertedSeparatorIndex?: number | null,
): string {
  // A context PATCH may resolve after the user has continued editing. Text is
  // mutable user data, so only clean up the mention from the exact snapshot
  // that initiated the request. Trying to rebase by token count or ordinal can
  // delete a newer, unrelated occurrence of the same token.
  if (latestInput !== inputAtSelection) return latestInput
  if (inputAtSelection.slice(mention.start, mention.end) !== mention.token) return latestInput
  return removeMentionToken(latestInput, mention, insertedSeparatorIndex)
}

export function replaceTypePromptToken(
  input: string,
  prompt: Pick<ActiveContextTypePrompt, 'start' | 'end'>,
  namespace: string,
): string {
  return `${input.slice(0, prompt.start)}@${namespace}:${input.slice(prompt.end)}`
}
