import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withIdempotency } from '@/lib/api/idempotency'
import { apiSuccess, apiError } from '@/lib/api/response'
import { actorFrom, lastActorFrom } from '@/lib/api/actor'
import { FieldValue } from 'firebase-admin/firestore'
import { proposeHypotheses } from '@/lib/seo/loops/hypotheses'
import type { ApiUser } from '@/lib/api/types'
import { inheritSprintCompanyFields } from '@/lib/seo/tenant'

export const dynamic = 'force-dynamic'

export const POST = withAuth(
  'admin',
  withIdempotency(async (_req: NextRequest, user: ApiUser, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params
    const ref = adminDb.collection('seo_optimizations').doc(id)
    const snap = await ref.get()
    if (!snap.exists) return apiError('Optimization not found', 404)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opt = snap.data() as any

    // Re-derive task list from hypothesis template
    const proposals = proposeHypotheses([opt.signal])
    const proposal = proposals.find((p) => p.hypothesisType === opt.hypothesisType) ?? proposals[0]
    if (!proposal) return apiError('No matching hypothesis template', 500)

    const taskIds: string[] = []
    for (const t of proposal.generatedTasks) {
      const taskRef = await adminDb.collection('seo_tasks').add({
        sprintId: opt.sprintId,
        orgId: opt.orgId,
        week: t.week,
        phase: t.phase,
        focus: 'Optimization',
        title: t.title,
        taskType: t.taskType,
        autopilotEligible: t.autopilotEligible,
        status: 'not_started',
        source: 'optimization',
        parentOptimizationId: id,
        createdAt: FieldValue.serverTimestamp(),
        deleted: false,
        ...inheritSprintCompanyFields(opt),
        ...actorFrom(user),
      })
      taskIds.push(taskRef.id)
    }

    // Snapshot baseline metrics
    const sprintSnap = await adminDb.collection('seo_sprints').doc(opt.sprintId).get()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sprint = sprintSnap.data() as any

    await ref.update({
      status: 'in_progress',
      generatedTaskIds: taskIds,
      baselineSnapshot: {
        capturedAt: new Date().toISOString(),
        sprintCurrentDay: sprint.currentDay,
      },
      outcomeMeasureScheduledFor: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      ...lastActorFrom(user),
    })

    return apiSuccess({ id, taskIds })
  }),
)
