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
    label: 'xAI (Grok)',
    capabilities: ['generate_image', 'generate_video', 'create_variants'],
    supportedInputKinds: ['brand_kit', 'upload', 'url', 'research_item', 'campaign', 'workspace_artifact'],
    supportedOutputKinds: ['image', 'video', 'campaign_asset', 'social_post_draft'],
    isAsync: false,
    usesExternalCredits: true,
    riskLevel: 'high',
    requiresApprovalBeforeClientVisibility: true,
    ownerAgentId: 'maya',
    connection: {
      authKind: 'api_key',
      credentialFields: [{ key: 'apiKey', label: 'API key', secret: true, placeholder: 'xai-…' }],
      consoleUrl: 'https://console.x.ai/team/default/api-keys',
      docsUrl: 'https://docs.x.ai/developers/quickstart',
    },
  },
  {
    key: 'google',
    label: 'Google (Gemini)',
    capabilities: ['generate_image', 'edit_image', 'generate_video', 'create_variants'],
    supportedInputKinds: ['brand_kit', 'upload', 'url', 'research_item', 'campaign', 'workspace_artifact'],
    supportedOutputKinds: ['image', 'video', 'campaign_asset', 'social_post_draft'],
    isAsync: false,
    usesExternalCredits: true,
    riskLevel: 'high',
    requiresApprovalBeforeClientVisibility: true,
    ownerAgentId: 'maya',
    connection: {
      authKind: 'api_key',
      credentialFields: [{ key: 'apiKey', label: 'Gemini API key', secret: true, placeholder: 'AIza…' }],
      consoleUrl: 'https://aistudio.google.com/apikey',
      docsUrl: 'https://ai.google.dev/gemini-api/docs/openai',
    },
  },
  {
    key: 'fal',
    label: 'fal.ai',
    capabilities: ['generate_image', 'generate_video', 'create_variants'],
    supportedInputKinds: ['brand_kit', 'upload', 'url', 'research_item', 'campaign', 'workspace_artifact'],
    supportedOutputKinds: ['image', 'video', 'campaign_asset', 'social_post_draft'],
    isAsync: true,
    usesExternalCredits: true,
    riskLevel: 'high',
    requiresApprovalBeforeClientVisibility: true,
    ownerAgentId: 'maya',
    connection: {
      authKind: 'api_key',
      credentialFields: [{ key: 'apiKey', label: 'API key', secret: true }],
      consoleUrl: 'https://fal.ai/dashboard/keys',
      docsUrl: 'https://fal.ai/docs',
    },
  },
  {
    key: 'recraft',
    label: 'Recraft',
    capabilities: ['generate_image', 'create_variants'],
    supportedInputKinds: ['brand_kit', 'upload', 'url', 'research_item', 'campaign', 'workspace_artifact'],
    supportedOutputKinds: ['image', 'campaign_asset', 'social_post_draft'],
    isAsync: false,
    usesExternalCredits: true,
    riskLevel: 'medium',
    requiresApprovalBeforeClientVisibility: true,
    ownerAgentId: 'maya',
    connection: {
      authKind: 'api_key',
      credentialFields: [{ key: 'apiKey', label: 'API token', secret: true }],
      consoleUrl: 'https://app.recraft.ai/profile/api',
      docsUrl: 'https://www.recraft.ai/docs/api-reference/getting-started',
    },
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
    connection: {
      authKind: 'api_key_secret',
      credentialFields: [
        { key: 'apiKey', label: 'API key', secret: true },
        { key: 'apiSecret', label: 'API secret', secret: true },
      ],
      consoleUrl: 'https://cloud.higgsfield.ai/api-keys',
    },
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
