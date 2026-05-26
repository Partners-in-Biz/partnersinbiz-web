import { FieldValue, type DocumentReference, type Firestore } from 'firebase-admin/firestore'

type FirestoreLike = Pick<Firestore, 'collection' | 'batch'>

type MoveProjectInput = {
  db: FirestoreLike
  projectId: string
  targetOrgId: string
  actorId: string
  actorRole: 'admin' | 'ai' | 'client' | string
}

type MoveCounts = {
  projectTasks: number
  standaloneTasks: number
  timeEntriesMoved: number
  timeEntriesSkippedBilled: number
  expensesMoved: number
  expensesSkippedBilled: number
  calendarEvents: number
}

type MoveProjectResult = {
  projectId: string
  projectName: string
  fromOrgId: string
  toOrgId: string
  targetOrgName: string
  targetOrgSlug?: string
  counts: MoveCounts
}

const BATCH_LIMIT = 450

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isBilledRecord(data: Record<string, unknown>): boolean {
  if (stringValue(data.invoiceId)) return true
  if (data.billed === true) return true
  const status = stringValue(data.status)?.toLowerCase()
  return status === 'billed' || status === 'invoiced' || status === 'paid'
}

async function queryByProjectId(db: FirestoreLike, collectionName: string, projectId: string) {
  return db.collection(collectionName).where('projectId', '==', projectId).get()
}

async function queryProjectCalendarEvents(db: FirestoreLike, projectId: string) {
  return db
    .collection('calendar_events')
    .where('relatedTo.type', '==', 'project')
    .where('relatedTo.id', '==', projectId)
    .get()
}

function newCounts(): MoveCounts {
  return {
    projectTasks: 0,
    standaloneTasks: 0,
    timeEntriesMoved: 0,
    timeEntriesSkippedBilled: 0,
    expensesMoved: 0,
    expensesSkippedBilled: 0,
    calendarEvents: 0,
  }
}

export async function moveProjectToClientOrg(input: MoveProjectInput): Promise<MoveProjectResult> {
  const projectId = input.projectId.trim()
  const targetOrgId = input.targetOrgId.trim()
  if (!projectId) throw new Error('projectId is required')
  if (!targetOrgId) throw new Error('targetOrgId is required')

  const projectRef = input.db.collection('projects').doc(projectId)
  const [projectDoc, targetOrgDoc] = await Promise.all([
    projectRef.get(),
    input.db.collection('organizations').doc(targetOrgId).get(),
  ])

  if (!projectDoc.exists) throw new Error('Project not found')
  if (!targetOrgDoc.exists) throw new Error('Target client organization not found')

  const project = (projectDoc.data?.() ?? {}) as Record<string, unknown>
  const targetOrg = (targetOrgDoc.data?.() ?? {}) as Record<string, unknown>
  if (targetOrg.active === false) throw new Error('Target client organization is inactive')

  const fromOrgId = stringValue(project.orgId) ?? stringValue(project.clientOrgId)
  if (!fromOrgId) throw new Error('Project has no source orgId')
  if (fromOrgId === targetOrgId && stringValue(project.clientOrgId) === targetOrgId) {
    throw new Error('Project is already assigned to that client')
  }

  const counts = newCounts()
  let batch = input.db.batch()
  let operations = 0

  const commitIfNeeded = async (force = false) => {
    if (!operations) return
    if (!force && operations < BATCH_LIMIT) return
    await batch.commit()
    batch = input.db.batch()
    operations = 0
  }

  const enqueueUpdate = async (ref: DocumentReference, data: Record<string, unknown>) => {
    batch.update(ref, data)
    operations += 1
    await commitIfNeeded(false)
  }

  const now = FieldValue.serverTimestamp()
  const actor = {
    updatedAt: now,
    updatedBy: input.actorId,
    updatedByType: input.actorRole === 'ai' ? 'agent' : input.actorRole === 'admin' ? 'user' : 'user',
  }

  await enqueueUpdate(projectRef, {
    orgId: targetOrgId,
    clientId: targetOrgId,
    clientOrgId: targetOrgId,
    movedFromOrgId: fromOrgId,
    movedToOrgId: targetOrgId,
    movedAt: now,
    movedBy: input.actorId,
    ...actor,
  })

  const projectTasksSnap = await projectRef.collection('tasks').get()
  for (const doc of projectTasksSnap.docs ?? []) {
    await enqueueUpdate(doc.ref, { orgId: targetOrgId, ...actor })
    counts.projectTasks += 1
  }

  const standaloneTasksSnap = await queryByProjectId(input.db, 'tasks', projectId)
  for (const doc of standaloneTasksSnap.docs ?? []) {
    await enqueueUpdate(doc.ref, { orgId: targetOrgId, ...actor })
    counts.standaloneTasks += 1
  }

  const timeEntriesSnap = await queryByProjectId(input.db, 'time_entries', projectId)
  for (const doc of timeEntriesSnap.docs ?? []) {
    const data = (doc.data?.() ?? {}) as Record<string, unknown>
    if (isBilledRecord(data)) {
      counts.timeEntriesSkippedBilled += 1
      continue
    }
    await enqueueUpdate(doc.ref, { orgId: targetOrgId, clientOrgId: targetOrgId, ...actor })
    counts.timeEntriesMoved += 1
  }

  const expensesSnap = await queryByProjectId(input.db, 'expenses', projectId)
  for (const doc of expensesSnap.docs ?? []) {
    const data = (doc.data?.() ?? {}) as Record<string, unknown>
    if (isBilledRecord(data)) {
      counts.expensesSkippedBilled += 1
      continue
    }
    await enqueueUpdate(doc.ref, { orgId: targetOrgId, clientOrgId: targetOrgId, ...actor })
    counts.expensesMoved += 1
  }

  const calendarSnap = await queryProjectCalendarEvents(input.db, projectId)
  for (const doc of calendarSnap.docs ?? []) {
    await enqueueUpdate(doc.ref, { orgId: targetOrgId, ...actor })
    counts.calendarEvents += 1
  }

  await commitIfNeeded(true)

  return {
    projectId,
    projectName: stringValue(project.name) ?? projectId,
    fromOrgId,
    toOrgId: targetOrgId,
    targetOrgName: stringValue(targetOrg.name) ?? targetOrgId,
    targetOrgSlug: stringValue(targetOrg.slug),
    counts,
  }
}
