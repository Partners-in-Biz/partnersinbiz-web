import type { ChatContextKind } from '@/lib/chat-context/types'
import {
  isChatContextKind,
  unavailableContextResult,
  type ChatContextAdapter,
  type ChatContextResolveInput,
  type ChatContextResolveResult,
} from '@/lib/chat-context/access'
import { projectChatContextAdapter } from '@/lib/chat-context/adapters/project'
import { marketingStudioChatContextAdapter } from '@/lib/chat-context/adapters/marketingStudio'
import { marketingStudioArtifactChatContextAdapter } from '@/lib/chat-context/adapters/marketingStudioArtifact'

export type ChatContextAdapters = Partial<Record<ChatContextKind, ChatContextAdapter>>

export function createChatContextRegistry(adapters: ChatContextAdapters) {
  return {
    async resolve(input: ChatContextResolveInput): Promise<ChatContextResolveResult> {
      if (!isChatContextKind(input.kind)) {
        return { ok: false, reason: 'unsupported', status: 400, error: 'Unsupported context kind' }
      }
      const adapter = adapters[input.kind]
      if (!adapter) return unavailableContextResult()
      return adapter.resolve(input)
    },
  }
}

export const chatContextRegistry = createChatContextRegistry({
  project: projectChatContextAdapter,
  studio: marketingStudioChatContextAdapter,
  studio_artifact: marketingStudioArtifactChatContextAdapter,
})
