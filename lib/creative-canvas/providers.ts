import type { CreativeCanvasProvider, CreativeCanvasProviderKey } from './types'

const PROVIDERS: CreativeCanvasProvider[] = [
  {
    key: 'manual_upload',
    label: 'Manual upload',
    capabilities: ['analyze_media'],
    supportedInputKinds: ['upload', 'workspace_artifact'],
    supportedOutputKinds: ['image', 'video', 'audio', 'copy', 'campaign_asset'],
    isAsync: false,
    usesExternalCredits: false,
    riskLevel: 'low',
    requiresApprovalBeforeClientVisibility: true,
    ownerAgentId: 'pip',
  },
  {
    key: 'xai',
    label: 'xAI image generation',
    capabilities: ['generate_image', 'create_variants'],
    supportedInputKinds: ['brand_kit', 'upload', 'url', 'research_item', 'campaign', 'workspace_artifact'],
    supportedOutputKinds: ['image', 'campaign_asset', 'social_post_draft'],
    isAsync: false,
    usesExternalCredits: true,
    riskLevel: 'high',
    requiresApprovalBeforeClientVisibility: true,
    ownerAgentId: 'maya',
  },
  {
    key: 'higgsfield',
    label: 'Higgsfield',
    capabilities: ['generate_image', 'edit_image', 'generate_video', 'edit_video', 'analyze_media', 'create_variants'],
    supportedInputKinds: ['brand_kit', 'upload', 'url', 'research_item', 'campaign', 'social_post', 'youtube_asset', 'book_studio_record', 'workspace_artifact'],
    supportedOutputKinds: ['image', 'video', 'caption', 'campaign_asset', 'social_post_draft', 'youtube_render', 'book_artifact'],
    isAsync: true,
    usesExternalCredits: true,
    riskLevel: 'high',
    requiresApprovalBeforeClientVisibility: true,
    ownerAgentId: 'maya',
  },
  {
    key: 'agent_task',
    label: 'Agent task',
    capabilities: ['generate_copy', 'generate_caption', 'generate_document_block', 'analyze_media', 'create_variants'],
    supportedInputKinds: ['brand_kit', 'upload', 'url', 'research_item', 'client_document', 'campaign', 'social_post', 'youtube_asset', 'book_studio_record', 'workspace_artifact'],
    supportedOutputKinds: ['copy', 'caption', 'blog_draft', 'document_block', 'campaign_asset', 'book_artifact', 'social_post_draft'],
    isAsync: true,
    usesExternalCredits: false,
    riskLevel: 'medium',
    requiresApprovalBeforeClientVisibility: true,
    ownerAgentId: 'pip',
  },
]

export function listCreativeCanvasProviders(): CreativeCanvasProvider[] {
  return PROVIDERS.map((provider) => ({
    ...provider,
    capabilities: [...provider.capabilities],
    supportedInputKinds: [...provider.supportedInputKinds],
    supportedOutputKinds: [...provider.supportedOutputKinds],
  }))
}

export function getCreativeCanvasProvider(key: string): CreativeCanvasProvider | null {
  const provider = PROVIDERS.find((item) => item.key === key as CreativeCanvasProviderKey)
  return provider ? listCreativeCanvasProviders().find((item) => item.key === provider.key) ?? null : null
}
