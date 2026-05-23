import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { runAllDetectors } from './detectors'
import { proposeHypotheses } from './hypotheses'
import type { SprintStatus } from '@/lib/seo/types'
import type { ApiUser } from '@/lib/api/types'
import { ensureSeoOptimizationAgentHandoff } from '@/lib/seo/blocker-handoff'
// Auto-register all detectors
import './detectors/register'

const ACTIVE: SprintStatus[] = ['active', 'compounding']
const OPTIMIZATION_CRON_ACTOR: ApiUser = { uid: 'seo-optimization-cron', role: 'ai' }

export async function runOptimizationLoopForSprint(
  sprintId: string,
  actor: ApiUser = OPTIMIZATION_CRON_ACTOR,
): Promise<{
  signalsFound: number
  proposalsCreated: number
  agentHandoff?: {
    projectId: string | null
    projectTaskId: string | null
    optimizationIds: string[]
  } | null
}> {
  const snap = await adminDb.collection('seo_sprints').doc(sprintId).get()
  if (!snap.exists) return { signalsFound: 0, proposalsCreated: 0 }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sprint = snap.data() as any
  if (!ACTIVE.includes(sprint.status)) return { signalsFound: 0, proposalsCreated: 0 }

  const recentSnap = await adminDb
    .collection('seo_optimizations')
    .where('sprintId', '==', sprintId)
    .where('detectedAt', '>=', new Date(Date.now() - 7 * 86_400_000).toISOString())
    .get()
  const cap = (sprint.currentDay ?? 0) <= 28 ? 2 : 99
  if (recentSnap.size >= cap) return { signalsFound: 0, proposalsCreated: 0 }

  const signals = await runAllDetectors({
    sprintId,
    orgId: sprint.orgId,
    startDate: sprint.startDate,
    currentDay: sprint.currentDay ?? 0,
    currentWeek: sprint.currentWeek ?? 0,
    currentPhase: sprint.currentPhase ?? 0,
  })

  const proposals = proposeHypotheses(signals, sprint.scoreboard)
  let proposalsCreated = 0
  const optimizationIds: string[] = []
  const remaining = cap - recentSnap.size
  for (let i = 0; i < proposals.length && i < remaining; i++) {
    const p = proposals[i]
    const matchingSignal = signals.find((sig) => p.hypothesisType.startsWith(sig.type)) ?? signals[0]
    const optimizationRef = await adminDb.collection('seo_optimizations').add({
      sprintId,
      orgId: sprint.orgId,
      detectedAt: new Date().toISOString(),
      signal: matchingSignal,
      hypothesis: p.hypothesis,
      hypothesisType: p.hypothesisType,
      proposedAction: p.proposedAction,
      generatedTaskIds: [],
      status: 'proposed',
      deleted: false,
      createdAt: FieldValue.serverTimestamp(),
    })
    optimizationIds.push(optimizationRef.id)
    proposalsCreated++
  }

  // Update sprint health summary
  await snap.ref.update({
    health: {
      score: signals.length === 0 ? 100 : Math.max(0, 100 - signals.length * 10),
      signals: signals.slice(0, 20),
    },
  })

  const result: {
    signalsFound: number
    proposalsCreated: number
    agentHandoff?: {
      projectId: string | null
      projectTaskId: string | null
      optimizationIds: string[]
    } | null
  } = { signalsFound: signals.length, proposalsCreated }
  if (optimizationIds.length > 0) {
    const agentHandoff = await ensureSeoOptimizationAgentHandoff({
      sprintId,
      optimizationIds,
      actor,
    })
    if (agentHandoff) result.agentHandoff = agentHandoff
  }
  return result
}

export async function runWeeklyOptimizationLoop(): Promise<{ processed: number; proposalsCreated: number }> {
  const snap = await adminDb
    .collection('seo_sprints')
    .where('deleted', '==', false)
    .where('status', 'in', ACTIVE)
    .get()
  let processed = 0
  let proposalsCreated = 0
  for (const s of snap.docs) {
    const r = await runOptimizationLoopForSprint(s.id)
    processed++
    proposalsCreated += r.proposalsCreated
  }
  return { processed, proposalsCreated }
}
