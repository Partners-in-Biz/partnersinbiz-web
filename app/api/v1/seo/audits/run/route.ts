import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { runSiteAudit } from '@/lib/seo/onpage-audit'
import { generateAuditSnapshot } from '@/lib/seo/audits'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => null)

  // URL-only mode (no sprint)
  if (!body?.sprintId && body?.url) {
    const result = await runSiteAudit(body.url, body.focusKeyword)
    return apiSuccess(result)
  }

  if (!body?.sprintId) return apiError('sprintId or url is required', 400)

  const sprintSnap = await adminDb.collection('seo_sprints').doc(body.sprintId).get()
  if (!sprintSnap.exists) return apiError('Sprint not found', 404)
  const sprint = sprintSnap.data() as any
  if (user.role !== 'ai' && sprint.orgId !== user.orgId) return apiError('Access denied', 403)

  const siteUrl = sprint.siteUrl as string
  if (!siteUrl) return apiError('Sprint has no siteUrl', 400)

  // Run both in parallel
  const [result, auditId] = await Promise.all([
    runSiteAudit(siteUrl, body.focusKeyword),
    generateAuditSnapshot(body.sprintId, sprint.currentDay ?? 0),
  ])

  // Update the created audit doc with on-page data
  await adminDb.collection('seo_audits').doc(auditId).update({
    onPageScore: result.score,
    issueBreakdown: result.breakdown,
    issueCategories: result.categories,
  })

  return apiSuccess({ auditId, ...result }, 201)
})
