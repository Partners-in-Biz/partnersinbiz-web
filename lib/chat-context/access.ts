import type { ApiUser } from '@/lib/api/types'
import type { ChatContextKind, ChatContextReadModel } from '@/lib/chat-context/types'
import { CONTEXT_REFERENCE_TYPES, type ContextReferenceSeed } from '@/lib/context-references/types'

export interface ChatContextResolveInput {
  kind: ChatContextKind
  id: string
  // Only accepted for task contexts. It identifies the canonical project
  // subcollection to inspect and is never trusted as an access grant.
  projectId?: string
  artifactId?: string
  /** A persisted, server-authorised conversation reference for opaque Workbench paths. */
  contextReference?: ContextReferenceSeed
  user: ApiUser
}

export type ChatContextResolveResult =
  | { ok: true; model: ChatContextReadModel; revision?: string }
  | {
      ok: false
      reason: 'invalid' | 'unsupported' | 'disabled' | 'forbidden' | 'not_found'
      status: number
      error: string
    }

export interface ChatContextAdapter {
  resolve(input: ChatContextResolveInput): Promise<ChatContextResolveResult>
}

export const CHAT_CONTEXT_KINDS: readonly ChatContextKind[] = CONTEXT_REFERENCE_TYPES

export function isChatContextKind(value: string): value is ChatContextKind {
  return CHAT_CONTEXT_KINDS.includes(value as ChatContextKind)
}

export function isOpaqueContextId(value: string): boolean {
  return value.length > 0 && value.length <= 200 && /^[A-Za-z0-9._:-]+$/.test(value)
}

export function unavailableContextResult(): ChatContextResolveResult {
  return { ok: false, reason: 'disabled', status: 404, error: 'Context unavailable' }
}
