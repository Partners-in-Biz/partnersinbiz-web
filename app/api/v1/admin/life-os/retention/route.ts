import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { runFirestoreLifeOsRetention } from '@/lib/privacy/life-os-retention-firestore'
import type { LifeOsRetentionMode } from '@/lib/privacy/life-os-retention'

export const dynamic = 'force-dynamic'

export const POST = withAuth('admin', async (req, user) => {
  const body = await req.json().catch(() => ({})) as {
    orgId?: string
    ownerUid?: string
    mode?: LifeOsRetentionMode
    approvalEvidence?: string
    now?: string
  }

  const orgId = body.orgId?.trim()
  const ownerUid = body.ownerUid?.trim()
  const mode = body.mode ?? 'dry-run'

  if (!orgId) return apiError('orgId is required')
  if (!ownerUid) return apiError('ownerUid is required')
  if (mode !== 'dry-run' && mode !== 'commit') return apiError('mode must be dry-run or commit')
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)
  if (mode === 'commit' && !body.approvalEvidence?.trim()) {
    return apiError('approvalEvidence is required for commit mode; run dry-run first and attach approval evidence before any destructive/anonymising run', 400)
  }

  try {
    const report = await runFirestoreLifeOsRetention({
      orgId,
      ownerUid,
      mode,
      approvalEvidence: body.approvalEvidence,
      now: body.now,
    })
    return apiSuccess(report)
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Life OS retention run failed', 400)
  }
})
