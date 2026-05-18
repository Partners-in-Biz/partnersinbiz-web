/**
 * GET /api/v1/admin/agents/[agentId]/logs
 *
 * Returns recent Hermes runs associated with this agent's profile name.
 * Individual Hermes gateways do not expose /api/logs — we query Firestore instead.
 *
 * Query params:
 *   ?limit=N  — max runs to return (default 30, max 100)
 */
import { NextRequest } from 'next/server'
import { type QueryDocumentSnapshot, type DocumentData } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { isValidAgentId, type AgentId } from '@/lib/agents/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ agentId: string }> }

export const GET = withAuth('admin', async (req: NextRequest, _user, ctx) => {
  const { agentId } = await (ctx as Ctx).params
  if (!isValidAgentId(agentId)) return apiError('Invalid agentId', 400)

  const limitParam = Number(req.nextUrl.searchParams.get('limit') ?? '30')
  const limit = Math.min(Math.max(1, limitParam), 100)

  // hermes_runs stores runs created by any profile. Query by the agent's profile name.
  // No orderBy in the Firestore query — avoids the composite index requirement.
  // Fetch a 3x bucket per profile variant, merge, then sort + slice client-side.
  const fetchLimit = Math.min(limit * 3, 300)
  const profiles = [agentId, `${agentId}-main`]
  const snaps = await Promise.all(
    profiles.map((p) =>
      adminDb
        .collection('hermes_runs')
        .where('profile', '==', p)
        .limit(fetchLimit)
        .get(),
    ),
  )

  const mapDoc = (doc: QueryDocumentSnapshot<DocumentData>) => {
    const d = doc.data()
    return {
      id: doc.id,
      orgId: d.orgId ?? null,
      profile: d.profile ?? null,
      hermesRunId: d.hermesRunId ?? null,
      requestedBy: d.requestedBy ?? null,
      prompt: typeof d.prompt === 'string' ? d.prompt.slice(0, 200) : null,
      status: d.status ?? null,
      createdAt: d.createdAt?.toDate?.()?.toISOString() ?? null,
    }
  }

  const runs = snaps
    .flatMap((snap) => snap.docs.map(mapDoc))
    .sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return tb - ta
    })
    .slice(0, limit)

  return apiSuccess({ runs, total: runs.length })
})
