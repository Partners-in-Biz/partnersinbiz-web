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

export function removeMentionToken(input: string, mention: Pick<ActiveContextMention, 'start' | 'end'>): string {
  return `${input.slice(0, mention.start)}${input.slice(mention.end)}`.replace(/\s{2,}/g, ' ').trim()
}
