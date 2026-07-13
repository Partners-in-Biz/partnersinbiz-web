import { unavailableContextResult, type ChatContextAdapter } from '@/lib/chat-context/access'

// Domain-specific Studio adapters register here in subsequent vertical slices.
export const studioChatContextAdapter: ChatContextAdapter = {
  async resolve() { return unavailableContextResult() },
}
