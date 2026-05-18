import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withIdempotency } from '@/lib/api/idempotency'
import { apiSuccess, apiError } from '@/lib/api/response'
import { actorFrom } from '@/lib/api/actor'
import { FieldValue } from 'firebase-admin/firestore'
import { OUTRANK_90 } from '@/lib/seo/templates/outrank-90'
import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg, restrictedAdminOrgIds } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

// 15 SaaS directories pre-seeded into seo_backlinks per the Outrank template
const DEFAULT_DIRECTORIES = [
  { source: 'producthunt.com', domain: 'producthunt.com', theirDR: 80 },
  { source: 'g2.com', domain: 'g2.com', theirDR: 90 },
  { source: 'capterra.com', domain: 'capterra.com', theirDR: 88 },
  { source: 'crunchbase.com', domain: 'crunchbase.com', theirDR: 91 },
  { source: 'saashub.com', domain: 'saashub.com', theirDR: 62 },
  { source: 'alternativeto.net', domain: 'alternativeto.net', theirDR: 75 },
  { source: 'betalist.com', domain: 'betalist.com', theirDR: 58 },
  { source: 'stackshare.io', domain: 'stackshare.io', theirDR: 66 },
  { source: 'theresanaiforthat.com', domain: 'theresanaiforthat.com', theirDR: 55 },
  { source: 'futurepedia.io', domain: 'futurepedia.io', theirDR: 52 },
  { source: 'topai.tools', domain: 'topai.tools', theirDR: 44 },
  { source: 'startupbase.io', domain: 'startupbase.io', theirDR: 40 },
  { source: 'microlaunch.net', domain: 'microlaunch.net', theirDR: 38 },
  { source: 'launched.io', domain: 'launched.io', theirDR: 35 },
  { source: 'indiehackers.com', domain: 'indiehackers.com', theirDR: 72 },
] as const

export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const clientId = searchParams.get('clientId')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = adminDb.collection('seo_sprints')
  // Admins and ai see all sprints; client role is locked to their own org.
  if (user.role === 'client' && user.orgId) q = q.where('orgId', '==', user.orgId)
  if (user.role === 'admin') {
    const allowedOrgIds = restrictedAdminOrgIds(user)
    if (clientId && !canAccessOrg(user, clientId)) return apiError('Forbidden', 403)
    if (!clientId && allowedOrgIds.length > 0 && allowedOrgIds.length <= 30) {
      q = q.where('orgId', 'in', allowedOrgIds)
    }
  }
  if (status) q = q.where('status', '==', status)
  if (clientId) q = q.where('clientId', '==', clientId)
  const snap = await q.get()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = snap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d: any) => ({ id: d.id, ...d.data() }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((d: any) => !d.deleted)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((d: any) => user.role !== 'admin' || canAccessOrg(user, d.orgId))
  return apiSuccess(data, 200, { total: data.length, page: 1, limit: data.length })
})

export const POST = withAuth(
  'admin',
  withIdempotency(async (req: NextRequest, user: ApiUser) => {
    const body = await req.json().catch(() => null)
    if (!body?.clientId) return apiError('clientId is required', 400)
    if (!body?.siteUrl) return apiError('siteUrl is required', 400)
    if (!body?.siteName) return apiError('siteName is required', 400)
    // For admin/ai callers, prefer body.orgId so a sprint can be scoped to ANY
    // client (admins are not locked to their own home org). For non-admin
    // callers we fall back to their own orgId.
    const orgId =
      user.role === 'admin' || user.role === 'ai'
        ? (body.orgId ?? body.clientId ?? user.orgId)
        : user.orgId
    if (!orgId) return apiError('orgId is required (no user.orgId set)', 400)
    if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)

    const startDate = body.startDate ?? new Date().toISOString()
    const sprintRef = await adminDb.collection('seo_sprints').add({
      orgId,
      clientId: body.clientId,
      siteUrl: body.siteUrl,
      siteName: body.siteName,
      startDate,
      currentDay: 0,
      currentWeek: 0,
      currentPhase: 0,
      status: 'pre-launch',
      templateId: 'outrank-90',
      autopilotMode: body.autopilotMode ?? 'safe',
      autopilotTaskTypes: body.autopilotTaskTypes ?? [],
      integrations: {
        gsc: { connected: false },
        bing: { connected: false },
        pagespeed: { enabled: body.pagespeedEnabled ?? true },
      },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      deleted: false,
      ...actorFrom(user),
    })

    // Seed tasks from template
    for (const t of OUTRANK_90.tasks) {
      await adminDb.collection('seo_tasks').add({
        sprintId: sprintRef.id,
        orgId,
        week: t.week,
        phase: t.phase,
        focus: t.focus,
        title: t.title,
        taskType: t.taskType,
        autopilotEligible: t.autopilotEligible,
        internalToolUrl: t.internalToolPath ?? null,
        status: 'not_started',
        source: 'template',
        createdAt: FieldValue.serverTimestamp(),
        deleted: false,
        ...actorFrom(user),
      })
    }

    // Seed 15 directory backlinks
    for (const dir of DEFAULT_DIRECTORIES) {
      await adminDb.collection('seo_backlinks').add({
        sprintId: sprintRef.id,
        orgId,
        source: dir.source,
        domain: dir.domain,
        type: 'directory',
        theirDR: dir.theirDR,
        status: 'not_started',
        discoveredVia: 'manual',
        createdAt: FieldValue.serverTimestamp(),
        deleted: false,
        ...actorFrom(user),
      })
    }

    return apiSuccess(
      { id: sprintRef.id, siteUrl: body.siteUrl, siteName: body.siteName, status: 'pre-launch' },
      201,
    )
  }),
)
