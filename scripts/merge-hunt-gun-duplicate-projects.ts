import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { logActivity } from '@/lib/activity/log'
import { touchPortalDashboardSummary } from '@/lib/portal/dashboard-summary'

const CANONICAL_PROJECT_ID = 'Rl6rpFOs6YbYQOLDRQJl'
const DUPLICATE_PROJECT_IDS = [
  '6ztG2iw3M7TblGuC6Igq',
  'MaxgAbOlZy3A1mQLGMKG',
] as const

const TASK_MAPPINGS: Record<string, string> = {
  '2tImPlf6lspVv2m0XSIy': '9SZfLV5VgRRESM7HS8uS',
  '3HcPjN6ccgSyfM4M5nJi': 'jexXcauDlzCspbnWM5pM',
  C8QWpbaDmLqF7NJB6ed2: 'STrFRgK6lS3sew6EJKRB',
  IB8ioAnq67wME7Ix5swt: 'PoWbiSG74omEDR5zL0tV',
  MSv8XG3N5yqh5Mm2f1jv: 'dqzwlDYzoaxJigZdeEzY',
  Tl7kZEYXHilcW3JiXJ7L: 'PoWbiSG74omEDR5zL0tV',
  VMOCT2yRONfA9u2OeYt0: 'IbGRZroUfwEgU3T10D9W',
  W83xBWJdNpTLr6KOO2BX: 'i275cN6PxdYX7OPIxPN9',
  WYA6k26vkTejV2BjaQDQ: 'IbGRZroUfwEgU3T10D9W',
  mI2n06K1cwMT0ZqM9fAi: 'aOnLWrvVnqI0GfPcRZ0L',
  min5tcGNsIgzrzIH5pvY: 'StrbizuZaSN6SZNYWf1H',
  q7V21NXTfE9qoxMwf0MO: 'IJJ421qc0srTsJ8dW8Dd',
  soW8xMbNL49P9NugtLx3: 'aOnLWrvVnqI0GfPcRZ0L',
  ww33dmose3OiWm4wSnyE: 'Og9J8TC4YQ2ZkDlrp7hs',
  yLMxl5e5M2KBkAfyf8ge: 'sNHj26qnyLKYujzIJkHp',
}

const ACTOR_ID = 'agent:pip'
const APPLY = process.argv.includes('--apply')

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function loadPlan() {
  const canonicalRef = adminDb.collection('projects').doc(CANONICAL_PROJECT_ID)
  const canonicalDoc = await canonicalRef.get()
  if (!canonicalDoc.exists) throw new Error('Canonical project does not exist')

  const canonicalTasks = await canonicalRef.collection('tasks').get()
  const canonicalTitles = new Map(
    canonicalTasks.docs.map((doc) => [doc.id, stringValue(doc.data().title)]),
  )

  const sources = []
  for (const sourceProjectId of DUPLICATE_PROJECT_IDS) {
    const sourceRef = adminDb.collection('projects').doc(sourceProjectId)
    const sourceDoc = await sourceRef.get()
    if (!sourceDoc.exists) throw new Error(`Duplicate project ${sourceProjectId} does not exist`)

    const sourceTasks = await sourceRef.collection('tasks').get()
    const tasks = sourceTasks.docs.map((doc) => {
      const targetTaskId = TASK_MAPPINGS[doc.id]
      if (!targetTaskId) throw new Error(`No canonical mapping for source task ${doc.id}`)
      const targetTitle = canonicalTitles.get(targetTaskId)
      if (!targetTitle) throw new Error(`Canonical task ${targetTaskId} does not exist`)
      return {
        sourceTaskId: doc.id,
        sourceTitle: stringValue(doc.data().title),
        sourceColumnId: stringValue(doc.data().columnId),
        sourceAgentStatus: stringValue(doc.data().agentStatus),
        targetTaskId,
        targetTitle,
      }
    })

    const project = sourceDoc.data() ?? {}
    sources.push({
      sourceProjectId,
      sourceName: stringValue(project.name),
      alreadyMerged: project.mergedIntoProjectId === CANONICAL_PROJECT_ID && project.archived === true,
      tasks,
    })
  }

  return {
    canonicalProjectId: CANONICAL_PROJECT_ID,
    canonicalName: stringValue(canonicalDoc.data()?.name),
    sources,
  }
}

async function applyMerge(plan: Awaited<ReturnType<typeof loadPlan>>) {
  const canonicalRef = adminDb.collection('projects').doc(CANONICAL_PROJECT_ID)
  const now = FieldValue.serverTimestamp()

  await adminDb.runTransaction(async (transaction) => {
    transaction.update(canonicalRef, {
      mergedProjectIds: FieldValue.arrayUnion(...DUPLICATE_PROJECT_IDS),
      lastMergedAt: now,
      lastMergedBy: ACTOR_ID,
      updatedAt: now,
      updatedBy: ACTOR_ID,
      updatedByType: 'agent',
    })

    for (const source of plan.sources) {
      const sourceRef = adminDb.collection('projects').doc(source.sourceProjectId)
      transaction.update(sourceRef, {
        archived: true,
        archivedAt: now,
        archivedBy: ACTOR_ID,
        mergeStatus: 'merged',
        mergedAt: now,
        mergedBy: ACTOR_ID,
        mergedIntoProjectId: CANONICAL_PROJECT_ID,
        updatedAt: now,
        updatedBy: ACTOR_ID,
        updatedByType: 'agent',
      })

      for (const mapping of source.tasks) {
        transaction.update(sourceRef.collection('tasks').doc(mapping.sourceTaskId), {
          archived: true,
          archivedAt: now,
          archivedBy: ACTOR_ID,
          mergeStatus: 'mapped_to_canonical',
          mergedIntoProjectId: CANONICAL_PROJECT_ID,
          mergedIntoTaskId: mapping.targetTaskId,
          updatedAt: now,
          updatedBy: ACTOR_ID,
          updatedByType: 'agent',
        })
      }

      transaction.set(canonicalRef.collection('mergeHistory').doc(source.sourceProjectId), {
        sourceProjectId: source.sourceProjectId,
        sourceProjectName: source.sourceName,
        canonicalProjectId: CANONICAL_PROJECT_ID,
        mergedAt: now,
        mergedBy: ACTOR_ID,
        sourceTaskCount: source.tasks.length,
        taskMappings: source.tasks,
        preservation: 'Source project, tasks, comments, and evidence remain in the archived source record.',
      })
    }

    const releaseTaskRef = canonicalRef.collection('tasks').doc('IbGRZroUfwEgU3T10D9W')
    transaction.set(releaseTaskRef.collection('comments').doc('merge_6ztG2iw3M7TblGuC6Igq'), {
      text: 'Duplicate-project merge audit: source task “Deploy frontend to Vercel” (VMOCT2yRONfA9u2OeYt0) reported Partners in Biz preview dpl_32GfNFwPZvuj3GnUbLY3Sb8G5khc while it was still Building. It is preserved as superseded evidence and was not accepted as Hunt & Gun CRM release proof. The source task and its comment remain available in archived project 6ztG2iw3M7TblGuC6Igq.',
      userId: ACTOR_ID,
      userName: 'Pip',
      userRole: 'ai',
      agentPickedUp: false,
      agentPickedUpAt: null,
      contextRefs: [],
      createdAt: now,
    })
  })

  await Promise.all([
    touchPortalDashboardSummary({
      orgId: 'pib-platform-owner',
      staleReason: 'project.merged',
    }),
    ...DUPLICATE_PROJECT_IDS.map((sourceProjectId) => logActivity({
      orgId: 'pib-platform-owner',
      type: 'project_merged',
      actorId: ACTOR_ID,
      actorName: 'Pip',
      actorRole: 'ai',
      description: `Merged duplicate project ${sourceProjectId} into ${CANONICAL_PROJECT_ID}`,
      entityId: CANONICAL_PROJECT_ID,
      entityType: 'project',
    })),
  ])
}

async function main() {
  const plan = await loadPlan()
  console.log(JSON.stringify(plan, null, 2))

  if (!APPLY) {
    console.log('Dry run only. Re-run with --apply to perform the merge.')
  } else if (plan.sources.every((source) => source.alreadyMerged)) {
    console.log('All duplicate projects are already merged; no changes applied.')
  } else {
    await applyMerge(plan)
    console.log('Duplicate projects merged and archived successfully.')
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
