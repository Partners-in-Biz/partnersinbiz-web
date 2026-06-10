import { NextRequest } from 'next/server'

import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { isPortalModuleEnabled } from '@/lib/organizations/portal-modules'

export const dynamic = 'force-dynamic'

function safeString(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function safeArtifacts(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((artifact) => {
      if (!artifact || typeof artifact !== 'object') return null
      const record = artifact as Record<string, unknown>
      const label = safeString(record.label, 'Open artifact')
      const href = safeString(record.href)
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

async function bookStudioModuleGuard(orgId: string) {
  const orgSnap = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgSnap.exists) return apiError('Organisation not found', 404)
  const org = orgSnap.data() ?? {}
  if (!isPortalModuleEnabled(org.settings, 'bookStudio')) {
    return apiError('Book Studio module is disabled for this client portal', 403, {
      moduleDisabled: true,
      module: 'bookStudio',
    })
  }
  return null
}

export const GET = withPortalAuthAndRole('viewer', async (_req: NextRequest, _uid: string, orgId: string) => {
  const guard = await bookStudioModuleGuard(orgId)
  if (guard) return guard

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
      reviewPackets: safeReviewPackets(data.reviewPackets),
      gates: safeGates(data.gates),
    }
  })

  return apiSuccess({ portalModule: 'bookStudio', projects })
})
