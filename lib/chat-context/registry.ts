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
import { videoEditorChatContextAdapter } from '@/lib/chat-context/adapters/videoEditor'
import { mobileAppsChatContextAdapter } from '@/lib/chat-context/adapters/mobileApps'
import { bookStudioChatContextAdapter } from '@/lib/chat-context/adapters/bookStudio'
import { youtubeStudioChatContextAdapter } from '@/lib/chat-context/adapters/youtubeStudio'
import { nonMarketingStudioRootChatContextAdapter } from '@/lib/chat-context/adapters/studioRoot'
import type { StudioKind } from '@/lib/chat-context/types'
import { genericChatContextAdapter } from '@/lib/chat-context/adapters/generic'
import { campaignChatContextAdapter } from '@/lib/chat-context/adapters/campaign'
import { socialChatContextAdapter } from '@/lib/chat-context/adapters/social'
import { seoSprintChatContextAdapter } from '@/lib/chat-context/adapters/seoSprint'
import { crmChatContextAdapter } from '@/lib/chat-context/adapters/crm'
import { commerceChatContextAdapter } from '@/lib/chat-context/adapters/commerce'
import { documentChatContextAdapter } from '@/lib/chat-context/adapters/document'
import { supportChatContextAdapter } from '@/lib/chat-context/adapters/support'
import { chatContextCapability } from '@/lib/chat-context/capabilities'

export type ChatContextAdapters = Partial<Record<ChatContextKind, ChatContextAdapter>>
type StudioRootAdapters = Record<StudioKind, ChatContextAdapter>

export function createStudioRootNamespaceAdapter(adapters: StudioRootAdapters): ChatContextAdapter {
  return {
    resolve(input) {
      const namespace = input.id.slice(0, input.id.indexOf(':')) as StudioKind
      const adapter = adapters[namespace]
      return adapter ? adapter.resolve(input) : Promise.resolve({ ok: false, reason: 'not_found' as const, status: 404 as const, error: 'Context unavailable' })
    },
  }
}

export function createChatContextRegistry(adapters: ChatContextAdapters, fallback?: ChatContextAdapter) {
  return {
    async resolve(input: ChatContextResolveInput): Promise<ChatContextResolveResult> {
      if (!isChatContextKind(input.kind)) {
        return { ok: false, reason: 'unsupported', status: 400, error: 'Unsupported context kind' }
      }
      const adapter = adapters[input.kind]
      if (!adapter && !fallback) return unavailableContextResult()
      const result = await (adapter ?? fallback)!.resolve(input)
      if (!result.ok) return result
      const capability = chatContextCapability(input.kind)
      const refreshedAt = Number.isFinite(Date.parse(result.model.asOf))
        ? new Date(result.model.asOf).toISOString()
        : new Date().toISOString()
      return {
        ...result,
        model: {
          ...result.model,
          freshness: {
            mode: 'live',
            authoritative: true,
            source: capability.authoritativeSource,
            refreshedAt,
            refreshIntervalMs: capability.refreshIntervalMs,
            adapterLevel: capability.adapterLevel,
            actionLevel: capability.actionLevel,
          },
        },
      }
    },
  }
}

export const chatContextRegistry = createChatContextRegistry({
  project: projectChatContextAdapter,
  campaign: campaignChatContextAdapter,
  social: socialChatContextAdapter,
  seo_sprint: seoSprintChatContextAdapter,
  contact: crmChatContextAdapter,
  company: crmChatContextAdapter,
  deal: crmChatContextAdapter,
  invoice: commerceChatContextAdapter,
  quote: commerceChatContextAdapter,
  document: documentChatContextAdapter,
  support: supportChatContextAdapter,
  studio: createStudioRootNamespaceAdapter({
    marketing_studio: marketingStudioChatContextAdapter,
    video_editor: nonMarketingStudioRootChatContextAdapter,
    book_studio: nonMarketingStudioRootChatContextAdapter,
    youtube_studio: nonMarketingStudioRootChatContextAdapter,
    mobile_apps: nonMarketingStudioRootChatContextAdapter,
  }),
  studio_artifact: {
    resolve(input) {
      if (input.id.startsWith('marketing_studio:')) return marketingStudioArtifactChatContextAdapter.resolve(input)
      if (input.id.startsWith('video_editor:')) return videoEditorChatContextAdapter.resolve(input)
      if (input.id.startsWith('mobile_apps:')) return mobileAppsChatContextAdapter.resolve(input)
      if (input.id.startsWith('book_studio:')) return bookStudioChatContextAdapter.resolve(input)
      if (input.id.startsWith('youtube_studio:')) return youtubeStudioChatContextAdapter.resolve(input)
      return Promise.resolve({ ok: false, reason: 'not_found' as const, status: 404, error: 'Context unavailable' })
    },
  },
}, genericChatContextAdapter)
