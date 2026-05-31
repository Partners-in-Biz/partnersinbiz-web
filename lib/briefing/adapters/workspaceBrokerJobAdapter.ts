/**
 * Source adapter for Workspace broker jobs.
 *
 * Pulls approval-gated Google Workspace operations into Briefings so admins can
 * approve or reject metadata-safe broker work from the control desk.
 */

import type { BriefingPriority, BriefingSourceAdapter } from '../types'
import { extractMultiFieldExcerpt, extractOrgId, hashSourceDocument, normalizeTimestamp } from '../utils'

interface WorkspaceBrokerJobDocument extends Record<string, unknown> {
  orgId?: string | null
  operation?: string | null
  status?: string | null
  requestedBy?: string | null
  createdByType?: string | null
  agentId?: string | null
  requiredCapability?: string | null
  riskLevel?: string | null
  input?: Record<string, unknown> | null
  output?: { googleMutationPerformed?: boolean; artifactId?: string | null; fileId?: string | null; url?: string | null } | null
  error?: string | null
  createdAt?: unknown
  updatedAt?: unknown
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function brokerOrgId(doc: WorkspaceBrokerJobDocument): string {
  return clean(doc.orgId) ?? extractOrgId(doc) ?? ''
}

function statusOf(doc: WorkspaceBrokerJobDocument): string {
  return (clean(doc.status) ?? 'requested').toLowerCase()
}

function operationOf(doc: WorkspaceBrokerJobDocument): string {
  return clean(doc.operation) ?? 'workspace_job'
}

function operationLabel(operation: string): string {
  if (operation === 'request_share') return 'share request'
  if (operation === 'request_delete') return 'delete request'
  return operation.replace(/_/g, ' ')
}

function artifactTitle(doc: WorkspaceBrokerJobDocument): string | null {
  return clean(doc.input?.title) ?? clean(doc.input?.artifactTitle) ?? clean(doc.input?.name)
}

function artifactId(doc: WorkspaceBrokerJobDocument): string | null {
  return clean(doc.input?.artifactId) ?? clean(doc.output?.artifactId)
}

function actorId(doc: WorkspaceBrokerJobDocument): string {
  if (clean(doc.agentId)) return `agent:${clean(doc.agentId)}`
  return clean(doc.requestedBy) ?? 'system'
}

function actorName(id: string): string | null {
  if (id.startsWith('agent:')) {
    const name = id.slice('agent:'.length)
    return name.charAt(0).toUpperCase() + name.slice(1)
  }
  return null
}

export const workspaceBrokerJobAdapter: BriefingSourceAdapter<WorkspaceBrokerJobDocument> = {
  sourceType: 'workspace-broker-job',
  collectionPath: 'workspace_broker_jobs',

  hashSource(doc: WorkspaceBrokerJobDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['operation', 'status', 'requestedBy', 'agentId', 'requiredCapability', 'riskLevel', 'input', 'output', 'error', 'updatedAt'])
  },

  shouldGenerate(doc: WorkspaceBrokerJobDocument): boolean {
    return ['awaiting_approval', 'blocked', 'failed'].includes(statusOf(doc))
  },

  extractPriority(doc: WorkspaceBrokerJobDocument): BriefingPriority {
    if (statusOf(doc) === 'failed' || statusOf(doc) === 'blocked') return 'critical'
    return doc.riskLevel === 'critical' ? 'critical' : 'needs-peet'
  },

  extractActor(doc: WorkspaceBrokerJobDocument) {
    const id = actorId(doc)
    return {
      id,
      name: actorName(id),
      role: id.startsWith('agent:') ? 'ai' as const : 'admin' as const,
      type: id.startsWith('agent:') ? 'agent' as const : 'user' as const,
    }
  },

  extractContext(doc: WorkspaceBrokerJobDocument, docId: string) {
    return {
      orgId: brokerOrgId(doc),
      workspaceBrokerJobId: docId,
      workspaceBrokerOperation: operationOf(doc),
      workspaceArtifactId: artifactId(doc),
      workspaceArtifactTitle: artifactTitle(doc),
    }
  },

  extractTitle(doc: WorkspaceBrokerJobDocument): string {
    const title = artifactTitle(doc)
    const prefix = `Workspace ${operationLabel(operationOf(doc))}`
    if (statusOf(doc) === 'awaiting_approval') return `${prefix} needs approval${title ? `: ${title}` : ''}`
    if (statusOf(doc) === 'failed') return `${prefix} failed${title ? `: ${title}` : ''}`
    return `${prefix} is blocked${title ? `: ${title}` : ''}`
  },

  extractSummary(doc: WorkspaceBrokerJobDocument): string {
    const op = operationLabel(operationOf(doc))
    const actor = this.extractActor(doc, '').name ?? this.extractActor(doc, '').id
    return `${actor} requested ${op}. Capability: ${clean(doc.requiredCapability) ?? 'unknown'}. Risk: ${clean(doc.riskLevel) ?? 'unknown'}.`
  },

  extractExcerpt(doc: WorkspaceBrokerJobDocument, _docId: string, maxLength = 300): string | null {
    return extractMultiFieldExcerpt({
      reason: doc.input?.reason,
      title: artifactTitle(doc),
      input: doc.input ? JSON.stringify(doc.input) : null,
      error: doc.error,
    }, ['reason', 'error', 'input', 'title'], { maxLength })
  },

  extractOccurredAt(doc: WorkspaceBrokerJobDocument): Date | null {
    return normalizeTimestamp(doc.updatedAt) ?? normalizeTimestamp(doc.createdAt)
  },

  extractMetadata(doc: WorkspaceBrokerJobDocument): Record<string, unknown> | null {
    return {
      brokerStatus: statusOf(doc),
      operation: operationOf(doc),
      riskLevel: clean(doc.riskLevel),
      requiredCapability: clean(doc.requiredCapability),
      requestedBy: clean(doc.requestedBy),
      createdByType: clean(doc.createdByType),
      agentId: clean(doc.agentId),
      googleMutationPerformed: doc.output?.googleMutationPerformed === true,
      outputUrl: clean(doc.output?.url),
    }
  },

  toItem(doc: WorkspaceBrokerJobDocument, docId: string) {
    const occurredAt = this.extractOccurredAt(doc, docId) ?? new Date()
    return {
      orgId: brokerOrgId(doc),
      source: {
        type: this.sourceType,
        id: docId,
        collectionPath: this.collectionPath,
        url: `/admin/knowledge/workspace-broker/jobs/${encodeURIComponent(docId)}`,
      },
      priority: this.extractPriority(doc, docId),
      status: 'active',
      title: this.extractTitle(doc, docId),
      summary: this.extractSummary(doc, docId),
      excerpt: this.extractExcerpt(doc, docId),
      actor: this.extractActor(doc, docId),
      context: this.extractContext(doc, docId),
      occurredAt,
      sourceHash: this.hashSource(doc, docId),
      metadata: this.extractMetadata?.(doc, docId),
      createdAt: occurredAt,
      updatedAt: occurredAt,
    }
  },
}
