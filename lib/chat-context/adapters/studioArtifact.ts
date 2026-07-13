import { unavailableContextResult, type ChatContextAdapter } from '@/lib/chat-context/access'

// Artifact records are intentionally opaque until their domain adapter is enabled.
export const studioArtifactChatContextAdapter: ChatContextAdapter = {
  async resolve() { return unavailableContextResult() },
}
