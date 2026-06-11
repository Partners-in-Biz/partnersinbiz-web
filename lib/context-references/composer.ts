import { contextReferenceTypeFrom, type ContextReferenceType } from './types'

export const CURRENT_PAGE_CONTEXT_PHRASE = 'use current page as context'

export interface ActiveContextMention {
  token: string
  namespace: string
  type: ContextReferenceType
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
  type: ContextReferenceType
  namespace: string
  label: string
}

export const CONTEXT_REFERENCE_MENTION_OPTIONS: ContextReferenceMentionOption[] = [
  { type: 'project', namespace: 'projects', label: 'Projects' },
  { type: 'task', namespace: 'tasks', label: 'Tasks' },
  { type: 'contact', namespace: 'contacts', label: 'Contacts' },
  { type: 'company', namespace: 'businesses', label: 'Businesses' },
  { type: 'product', namespace: 'products', label: 'Products' },
  { type: 'document', namespace: 'docs', label: 'Docs' },
  { type: 'research', namespace: 'research', label: 'Research' },
  { type: 'social', namespace: 'social', label: 'Social' },
  { type: 'campaign', namespace: 'campaigns', label: 'Campaigns' },
  { type: 'email', namespace: 'emails', label: 'Emails' },
  { type: 'support', namespace: 'support', label: 'Support' },
  { type: 'deal', namespace: 'deals', label: 'Deals' },
  { type: 'invoice', namespace: 'invoices', label: 'Invoices' },
  { type: 'quote', namespace: 'quotes', label: 'Quotes' },
  { type: 'property', namespace: 'properties', label: 'Properties' },
  { type: 'seo_sprint', namespace: 'seosprints', label: 'SEO sprints' },
  { type: 'workspace_folder', namespace: 'workspacefolders', label: 'Workspace folders' },
  { type: 'workspace_artifact', namespace: 'workspaceartifacts', label: 'Workspace artifacts' },
  { type: 'workspace_connection', namespace: 'workspaceconnections', label: 'Workspace connections' },
  { type: 'workspace_broker_job', namespace: 'brokerjobs', label: 'Workspace broker jobs' },
  { type: 'file', namespace: 'files', label: 'Files' },
  { type: 'report', namespace: 'reports', label: 'Reports' },
  { type: 'calendar_event', namespace: 'events', label: 'Calendar events' },
]

export function filterContextReferenceMentionOptions(query: string): ContextReferenceMentionOption[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return CONTEXT_REFERENCE_MENTION_OPTIONS
  return CONTEXT_REFERENCE_MENTION_OPTIONS.filter((option) => (
    option.namespace.includes(normalized) ||
    option.type.includes(normalized) ||
    option.label.toLowerCase().includes(normalized)
  ))
}

export function contextTypeFromMentionNamespace(namespace: string) {
  return contextReferenceTypeFrom(namespace)
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
  const type = contextTypeFromMentionNamespace(match[2])
  if (!type) return null
  const token = `@${match[2]}:${match[3] ?? ''}`
  const start = beforeCaret.length - token.length
  return {
    token,
    namespace: match[2].toLowerCase(),
    type,
    query: match[3] ?? '',
    start,
    end: caretIndex,
  }
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

export function removeMentionToken(input: string, mention: Pick<ActiveContextMention, 'start' | 'end'>): string {
  return `${input.slice(0, mention.start)}${input.slice(mention.end)}`.replace(/\s{2,}/g, ' ').trim()
}

export function replaceTypePromptToken(
  input: string,
  prompt: Pick<ActiveContextTypePrompt, 'start' | 'end'>,
  namespace: string,
): string {
  return `${input.slice(0, prompt.start)}@${namespace}:${input.slice(prompt.end)}`
}
