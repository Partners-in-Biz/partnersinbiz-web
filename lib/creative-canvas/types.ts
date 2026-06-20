export type CreativeCanvasStatus =
  | 'draft'
  | 'internal_review'
  | 'client_review'
  | 'approved'
  | 'archived'

export type CreativeCanvasVisibility = 'admin_agents' | 'admin_agents_clients'

export type CreativeCanvasActorType = 'user' | 'agent' | 'system'

export interface CreativeCanvasActor {
  uid: string
  type: CreativeCanvasActorType
}

export type CreativeCanvasNodeType =
  | 'source'
  | 'brief'
  | 'prompt'
  | 'model'
  | 'edit'
  | 'review'
  | 'output'

export type CreativeCanvasSourceKind =
  | 'brand_kit'
  | 'upload'
  | 'url'
  | 'research_item'
  | 'client_document'
  | 'campaign'
  | 'social_post'
  | 'youtube_asset'
  | 'book_studio_record'
  | 'workspace_artifact'

export type CreativeCanvasReferenceRole =
  | 'general'
  | 'product'
  | 'person'
  | 'character'
  | 'style'
  | 'background'
  | 'logo'
  | 'mask'
  | 'motion'

export type CreativeCanvasProviderKey =
  | 'higgsfield'
  | 'xai'
  | 'manual_upload'
  | 'text_generation'
  | 'document_generation'
  | 'agent_task'

export type CreativeCanvasOutputKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'caption'
  | 'copy'
  | 'blog_draft'
  | 'document_block'
  | 'book_artifact'
  | 'youtube_render'
  | 'campaign_asset'
  | 'social_post_draft'

export type CreativeCanvasReviewStatus = 'not_required' | 'needed' | 'passed' | 'warning' | 'blocked'
export type CreativeCanvasRightsStatus = 'unknown' | 'cleared' | 'needs_review' | 'blocked'
export type CreativeCanvasBrandStatus = 'unknown' | 'passed' | 'needs_review' | 'blocked'
export type CreativeCanvasGeneratedBy = 'user' | 'agent' | 'provider' | 'system'
export type CreativeCanvasRunStatus = 'queued' | 'running' | 'waiting_for_review' | 'completed' | 'failed' | 'cancelled'
export type CreativeCanvasPromptStorage = 'none' | 'summary' | 'full_internal'
export type CreativeCanvasProviderRiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type CreativeCanvasEditOperation =
  | 'inpaint'
  | 'outpaint'
  | 'style_transfer'
  | 'object_replace'
  | 'background_replace'
  | 'video_motion'
  | 'variation'
  | 'upscale'
export type CreativeCanvasEditMotionMode =
  | 'none'
  | 'camera_push'
  | 'camera_pull'
  | 'pan'
  | 'orbit'
  | 'dolly'
  | 'handheld'

export type CreativeCanvasProviderCapability =
  | 'generate_image'
  | 'edit_image'
  | 'generate_video'
  | 'edit_video'
  | 'generate_copy'
  | 'generate_caption'
  | 'generate_document_block'
  | 'analyze_media'
  | 'create_variants'

export interface CreativeCanvasProvider {
  key: CreativeCanvasProviderKey
  label: string
  capabilities: CreativeCanvasProviderCapability[]
  supportedInputKinds: CreativeCanvasSourceKind[]
  supportedOutputKinds: CreativeCanvasOutputKind[]
  isAsync: boolean
  usesExternalCredits: boolean
  riskLevel: CreativeCanvasProviderRiskLevel
  requiresApprovalBeforeClientVisibility: boolean
  ownerAgentId: string
}

export interface CreativeCanvasLinkMap {
  projectId?: string
  taskId?: string
  campaignId?: string
  researchItemId?: string
  clientDocumentId?: string
  socialPostId?: string
  youtubeVideoProjectId?: string
  bookStudioProjectId?: string
  workspaceArtifactIds?: string[]
}

export interface CreativeCanvas {
  id?: string
  orgId: string
  title: string
  status: CreativeCanvasStatus
  purpose: string
  linked: CreativeCanvasLinkMap
  activeVersion: number
  visibility: CreativeCanvasVisibility
  createdAt?: unknown
  createdBy: string
  createdByType: CreativeCanvasActorType
  updatedAt?: unknown
  updatedBy: string
  updatedByType: CreativeCanvasActorType
  deleted: boolean
  nodes: CreativeCanvasNode[]
  edges: CreativeCanvasEdge[]
}

export type CreativeCanvasInput = Omit<CreativeCanvas, 'id' | 'createdAt' | 'updatedAt' | 'nodes' | 'edges'> & {
  nodes?: CreativeCanvasNode[]
  edges?: CreativeCanvasEdge[]
}

export interface CreativeCanvasNode {
  id: string
  canvasId?: string
  orgId: string
  type: CreativeCanvasNodeType
  title: string
  position: { x: number; y: number }
  size?: { width: number; height: number }
  data: Record<string, unknown>
  source?: {
    kind: CreativeCanvasSourceKind
    refId?: string
    url?: string
    thumbnailUrl?: string
    previewUrl?: string
    storagePath?: string
    mimeType?: string
    altText?: string
    referenceRole?: CreativeCanvasReferenceRole
    weight?: number
  }
  provider?: {
    key: CreativeCanvasProviderKey
    model?: string
    mode?: string
  }
  edit?: {
    operation: CreativeCanvasEditOperation
    prompt?: string
    mask?: {
      sourceNodeId?: string
      url?: string
      storagePath?: string
      invert?: boolean
      region?: {
        x: number
        y: number
        width: number
        height: number
        unit: 'percent' | 'pixel'
        feather?: number
      }
    }
    references?: Array<{
      sourceNodeId: string
      role: CreativeCanvasReferenceRole
      weight?: number
    }>
    strength?: number
    motion?: {
      mode: CreativeCanvasEditMotionMode
      durationSeconds?: number
    }
    outputKind?: CreativeCanvasOutputKind
  }
  review?: {
    status: CreativeCanvasReviewStatus
    approvalGateTaskId?: string
    requiredReviewerAgentId?: string
    syntheticMediaDisclosure?: boolean
    rightsStatus?: CreativeCanvasRightsStatus
    brandStatus?: CreativeCanvasBrandStatus
  }
  output?: {
    kind: CreativeCanvasOutputKind
    artifactId?: string
    url?: string
    thumbnailUrl?: string
    storagePath?: string
    textPreview?: string
  }
  createdAt?: unknown
  updatedAt?: unknown
}

export interface CreativeCanvasEdge {
  id: string
  canvasId?: string
  orgId: string
  sourceNodeId: string
  targetNodeId: string
  label?: string
  data?: Record<string, unknown>
}

export interface CreativeCanvasGraph {
  nodes: CreativeCanvasNode[]
  edges: CreativeCanvasEdge[]
}

export interface CreativeCanvasSourceLibraryItem {
  id: string
  title: string
  description?: string
  sourceCollection: string
  source: NonNullable<CreativeCanvasNode['source']>
}

export interface CreativeCanvasVersion {
  id?: string
  orgId: string
  canvasId: string
  version: number
  nodes: CreativeCanvasNode[]
  edges: CreativeCanvasEdge[]
  createdAt?: unknown
  createdBy: string
  createdByType: CreativeCanvasActorType
  reason?: string
}

export interface CreativeCanvasComment {
  id?: string
  orgId: string
  canvasId: string
  nodeId?: string
  body: string
  visibility: CreativeCanvasVisibility
  resolved: boolean
  createdAt?: unknown
  createdBy: string
  createdByType: CreativeCanvasActorType
  updatedAt?: unknown
}

export type CreativeCanvasOutputPatch = Pick<NonNullable<CreativeCanvasNode['output']>, 'kind'> &
  Partial<Omit<NonNullable<CreativeCanvasNode['output']>, 'kind'>> & {
    review?: CreativeCanvasReviewPatch
  }

export interface CreativeCanvasReviewPatch {
  status?: CreativeCanvasReviewStatus
  approvalGateTaskId?: string
  requiredReviewerAgentId?: string
  syntheticMediaDisclosure?: boolean
  rightsStatus?: CreativeCanvasRightsStatus
  brandStatus?: CreativeCanvasBrandStatus
}

export interface CreativeCanvasRun {
  id?: string
  orgId: string
  canvasId: string
  nodeId: string
  providerKey: CreativeCanvasProviderKey
  model?: string
  status: CreativeCanvasRunStatus
  input: {
    promptSummary?: string
    sourceNodeIds: string[]
    sourceArtifactIds: string[]
    format?: string
    aspectRatio?: string
    durationSeconds?: number
    outputKind?: CreativeCanvasOutputKind
    operation?: CreativeCanvasEditOperation
    variantCount?: number
    seed?: string
    stylePreset?: string
    cameraMotion?: CreativeCanvasEditMotionMode
    negativePrompt?: string
  }
  output?: {
    outputNodeId?: string
    artifactId?: string
    url?: string
    thumbnailUrl?: string
    textPreview?: string
    rawProviderJobId?: string
  }
  provenance: {
    generatedBy: CreativeCanvasGeneratedBy
    agentId?: string
    providerJobId?: string
    providerRequestId?: string
    providerStatusUrl?: string
    providerCallbackUrl?: string
    model?: string
    costUnits?: number
    costLabel?: string
    promptStored: CreativeCanvasPromptStorage
    syntheticMedia: boolean
  }
  error?: {
    code: string
    message: string
    retryable: boolean
  }
  createdAt?: unknown
  updatedAt?: unknown
}

export interface CreativeCanvasExport {
  id?: string
  orgId: string
  canvasId: string
  nodeId: string
  target: 'social_draft' | 'campaign_asset' | 'client_document' | 'research' | 'youtube_studio' | 'book_studio' | 'workspace_artifact'
  targetId?: string
  status: 'drafted' | 'blocked' | 'completed' | 'failed'
  createdAt?: unknown
  createdBy: string
  createdByType: CreativeCanvasActorType
}
