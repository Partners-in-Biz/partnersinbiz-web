import type { ContextReferenceType } from '@/lib/context-references/types'

export type ChatContextKind = ContextReferenceType

export type ContextDisplayState =
  | 'ready' | 'running' | 'waiting' | 'needs_input' | 'needs_approval'
  | 'blocked' | 'review' | 'complete' | 'published' | 'archived'

export type StudioKind =
  | 'marketing_studio' | 'video_editor' | 'book_studio' | 'youtube_studio' | 'mobile_apps'

export interface ConversationOrigin {
  conversationId: string
  requestMessageId: string
  responseMessageId: string
  bundleId: string
  sequence: number
}

export interface ChatContextReference {
  kind: ChatContextKind
  id: string
  // Task records can live in a project's tasks subcollection. This remains
  // presentation metadata only; the server still re-checks project access
  // before resolving the task.
  projectId?: string
}

export function chatContextReferenceKey(reference: ChatContextReference): string {
  return reference.kind === 'task' && reference.projectId
    ? `${reference.kind}:${encodeURIComponent(reference.projectId)}:${encodeURIComponent(reference.id)}`
    : `${reference.kind}:${encodeURIComponent(reference.id)}`
}

export interface ChatContextPreview {
  kind: 'summary' | 'document' | 'email'
  text?: string
  status?: string
  version?: string
}

export interface ChatContextRelationship {
  kind: ChatContextKind
  id: string
  label: string
  relation: string
  href?: string
}

export interface ChatContextAction {
  id: string
  label: string
  href?: string
  method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  destructive?: boolean
  requiresApproval?: boolean
  body?: Record<string, unknown>
}

export interface ContextItemSummary {
  id: string
  label: string
  state: ContextDisplayState
  detail?: string
  href?: string
  updatedAt?: string
  actions?: ChatContextAction[]
}

export interface ChatArtifactSummary {
  id: string
  studioKind: StudioKind
  resourceType: string
  resourceId: string
  title: string
  artifactKind: 'image' | 'video' | 'audio' | 'document' | 'canvas' | 'book' | 'release' | 'app_asset' | 'collection'
  state: ContextDisplayState
  statusLabel: string
  preview?: {
    kind: 'image' | 'video' | 'audio' | 'document' | 'text' | 'none'
    url?: string
    thumbnailUrl?: string
    text?: string
    mimeType?: string
  }
  version?: string
  updatedAt?: string
  provenance?: { agentId?: string; model?: string; provider?: string; sourceIds?: string[] }
  review?: { required: boolean; status: string; reviewer?: string; approvalGateTaskId?: string }
  href: string
  actions: ChatContextAction[]
  conversationOrigin?: ConversationOrigin
}

export interface ContextAttentionSummary {
  id: string
  label: string
  state: Extract<ContextDisplayState, 'needs_input' | 'needs_approval' | 'blocked' | 'review'>
  detail?: string
  href?: string
  actions?: ChatContextAction[]
}

export type ContextActivityType =
  | 'pickup' | 'running' | 'waiting' | 'dependency_released'
  | 'failure' | 'blocked' | 'approval_required' | 'input_required'
  | 'review_required' | 'verified_complete'

export interface ContextActivitySummary {
  id: string
  type: ContextActivityType
  label: string
  occurredAt: string
  detail?: string
  actorLabel?: string
}

export interface ChatContextReadModel {
  context: { kind: ChatContextKind; id: string; orgId: string; label: string; icon: string; href?: string }
  pulse: {
    label: string
    progress?: { complete: number; total: number }
    metrics: Array<{ id: string; label: string; value: number | string; tone?: string }>
    headline?: string
    next?: ContextItemSummary
  }
  groups: Array<{ id: string; label: string; items: ContextItemSummary[] }>
  artifacts: ChatArtifactSummary[]
  attention: ContextAttentionSummary[]
  activity: ContextActivitySummary[]
  preview?: ChatContextPreview
  relationships?: ChatContextRelationship[]
  capabilities: string[]
  asOf: string
}
