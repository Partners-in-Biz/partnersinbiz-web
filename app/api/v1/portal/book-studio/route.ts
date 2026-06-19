import { NextRequest } from 'next/server'

import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import {
  canRolePerformModuleAction,
  resolveOrganizationModulePolicies,
} from '@/lib/organizations/module-policies'
import { isPortalModuleEnabled } from '@/lib/organizations/portal-modules'

export const dynamic = 'force-dynamic'

function safeString(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function safeHttpUrl(value: unknown) {
  const href = safeString(value).trim()
  if (!href) return ''
  try {
    const parsed = new URL(href)
    if (!['http:', 'https:'].includes(parsed.protocol)) return ''
    if (parsed.username || parsed.password) return ''
    return parsed.href
  } catch {
    return ''
  }
}

function safeArtifacts(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((artifact) => {
      if (!artifact || typeof artifact !== 'object') return null
      const record = artifact as Record<string, unknown>
      const label = safeString(record.label, 'Open artifact')
      const href = safeHttpUrl(record.href)
      if (!href) return null
      return { label, href }
    })
    .filter(Boolean)
}

function safeReviewPackets(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map((packet, index) => {
    const record = packet && typeof packet === 'object' ? (packet as Record<string, unknown>) : {}
    return {
      id: safeString(record.id, `packet-${index + 1}`),
      title: safeString(record.title, 'Review packet'),
      status: safeString(record.status, 'draft'),
      summary: safeString(record.summary),
      artifacts: safeArtifacts(record.artifacts),
    }
  })
}

function safeGates(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map((gate, index) => {
    const record = gate && typeof gate === 'object' ? (gate as Record<string, unknown>) : {}
    return {
      id: safeString(record.id, `gate-${index + 1}`),
      label: safeString(record.label, 'Quality gate'),
      status: safeString(record.status, 'not_started'),
    }
  })
}

function bookStudioCapabilities(settings: unknown, role: unknown) {
  const policies = resolveOrganizationModulePolicies(settings)
  return {
    canViewApprovalGates: canRolePerformModuleAction(policies, 'bookStudio', 'approvalGates', role),
    canViewPublishingPackets: canRolePerformModuleAction(policies, 'bookStudio', 'publishingPackets', role),
    canViewEvidenceRights: canRolePerformModuleAction(policies, 'bookStudio', 'evidenceRights', role),
  }
}

async function bookStudioModuleGuard(orgId: string, role: unknown) {
  const orgSnap = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgSnap.exists) return apiError('Organisation not found', 404)
  const org = orgSnap.data() ?? {}
  if (!isPortalModuleEnabled(org.settings, 'bookStudio')) {
    return apiError('Book Studio module is disabled for this client portal', 403, {
      moduleDisabled: true,
      module: 'bookStudio',
    })
  }
  const policies = resolveOrganizationModulePolicies(org.settings)
  if (!canRolePerformModuleAction(policies, 'bookStudio', 'visibility', role)) {
    return apiError('Book Studio module is disabled for your organisation role', 403, {
      moduleDisabled: true,
      module: 'bookStudio',
    })
  }
  return null
}

export const GET = withPortalAuthAndRole('viewer', async (_req: NextRequest, _uid: string, orgId: string, role) => {
  const guard = await bookStudioModuleGuard(orgId, role)
  if (guard) return guard

  const orgSnap = await adminDb.collection('organizations').doc(orgId).get()
  const capabilities = bookStudioCapabilities(orgSnap.data()?.settings, role)
  const snap = await adminDb.collection('book_studio_projects').where('orgId', '==', orgId).get()
  const projects = snap.docs.map((doc: { id: string; data: () => Record<string, unknown> }) => {
    const data = doc.data()
    return {
      id: doc.id,
      title: safeString(data.title, 'Untitled book project'),
      status: safeString(data.status, 'draft'),
      stage: safeString(data.stage),
      reviewStatus: safeString(data.reviewStatus),
      nextAction: safeString(data.nextAction),
      safeSummary: safeString(data.safeSummary),
      reviewPackets: capabilities.canViewPublishingPackets ? safeReviewPackets(data.reviewPackets) : [],
      gates: capabilities.canViewApprovalGates ? safeGates(data.gates) : [],
    }
  })

  return apiSuccess({ portalModule: 'bookStudio', projects, capabilities })
})
