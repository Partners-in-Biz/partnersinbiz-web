// lib/book-studio/capabilities.ts
import {
  canRolePerformModuleAction,
  resolveOrganizationModulePolicies,
} from '@/lib/organizations/module-policies'
import type { BookStudioResourceKey } from './types'

export interface BookStudioCapabilities {
  canView: boolean
  canCreate: boolean
  canEdit: boolean
  canEvidenceRights: boolean
  canApprovalGates: boolean
  canPublishingPackets: boolean
  canArchiveDelete: boolean
  isOperator: boolean
}

const ACTION_IDS = {
  canView: 'visibility',
  canCreate: 'create',
  canEdit: 'edit',
  canEvidenceRights: 'evidenceRights',
  canApprovalGates: 'approvalGates',
  canPublishingPackets: 'publishingPackets',
  canArchiveDelete: 'archiveDelete',
} as const

export type BookStudioCapabilityKey = Exclude<keyof BookStudioCapabilities, 'isOperator'>

export function resolveBookStudioCapabilities(
  orgSettings: unknown,
  role: unknown,
  isOperator: boolean,
): BookStudioCapabilities {
  if (isOperator) {
    return {
      canView: true, canCreate: true, canEdit: true,
      canEvidenceRights: true, canApprovalGates: true,
      canPublishingPackets: true, canArchiveDelete: true, isOperator: true,
    }
  }
  const policies = resolveOrganizationModulePolicies(orgSettings)
  const caps = Object.fromEntries(
    (Object.entries(ACTION_IDS) as Array<[BookStudioCapabilityKey, string]>).map(
      ([key, actionId]) => [key, canRolePerformModuleAction(policies, 'bookStudio', actionId, role)],
    ),
  ) as Record<BookStudioCapabilityKey, boolean>
  return { ...caps, isOperator: false }
}

// Resources portal sessions may touch at all. decision-logs and
// analytics-imports are internal/operator surfaces and 404 for portal callers.
const PORTAL_RESOURCES: ReadonlySet<BookStudioResourceKey> = new Set([
  'projects', 'chapters', 'pages', 'briefs', 'series',
  'artifact-links', 'rights-ledgers', 'publishing-packets', 'package-manifests',
] as BookStudioResourceKey[])

const READ_ACTION: Partial<Record<BookStudioResourceKey, BookStudioCapabilityKey>> = {
  'publishing-packets': 'canPublishingPackets',
  'package-manifests': 'canPublishingPackets',
  'rights-ledgers': 'canEvidenceRights',
  'artifact-links': 'canEvidenceRights',
}

const WRITE_ACTION: Partial<Record<BookStudioResourceKey, BookStudioCapabilityKey>> = {
  projects: 'canEdit',
  chapters: 'canEdit',
  pages: 'canEdit',
  briefs: 'canEdit',
  series: 'canEdit',
  'artifact-links': 'canEvidenceRights',
  'rights-ledgers': 'canEvidenceRights',
}

/**
 * Returns the capability a portal request must hold, or null when the
 * request is not allowed for portal sessions at all (operator-only).
 */
export function portalActionForRequest(
  method: 'GET' | 'POST' | 'PATCH',
  resource: BookStudioResourceKey,
  body: Record<string, unknown>,
): BookStudioCapabilityKey | null {
  if (!PORTAL_RESOURCES.has(resource)) return null
  if (method === 'GET') return READ_ACTION[resource] ?? 'canView'
  if (body.deleted === true) return 'canArchiveDelete'
  if (body.status === 'approved') return 'canApprovalGates'
  if (method === 'POST' && (resource === 'projects' || resource === 'series')) return 'canCreate'
  return WRITE_ACTION[resource] ?? null
}
