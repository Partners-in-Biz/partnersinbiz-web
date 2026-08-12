import { FieldValue } from 'firebase-admin/firestore'

import { adminDb } from '@/lib/firebase/admin'
import {
  buildProjectTaskReadModel,
  isProjectTaskReadModel,
  projectTaskReadModelTask,
} from '@/lib/projects/taskReadModel'
import { taskOrderMillis } from '@/lib/projects/taskPayload'

const READ_MODEL_COLLECTION = '_readModels'
const TASK_READ_MODEL_ID = 'tasks'

function readModelRef(projectId: string) {
  return adminDb.collection('projects').doc(projectId).collection(READ_MODEL_COLLECTION).doc(TASK_READ_MODEL_ID)
}

export async function getProjectTaskReadModel(projectId: string) {
  const snapshot = await readModelRef(projectId).get()
  const value = snapshot.exists ? snapshot.data() : undefined
  return isProjectTaskReadModel(value) ? value : null
}

export async function seedProjectTaskReadModel(projectId: string, tasks: Array<{ id: string; [key: string]: unknown }>) {
  const model = buildProjectTaskReadModel(tasks)
  await readModelRef(projectId).set({
    ...model,
    updatedAt: FieldValue.serverTimestamp(),
  })
  return model
}

/** Keep an existing projection fresh without ever scanning the task collection. */
export async function upsertProjectTaskReadModel(projectId: string, taskId: string, task: Record<string, unknown>) {
  const ref = readModelRef(projectId)
  await adminDb.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref)
    const existing = snapshot.exists && isProjectTaskReadModel(snapshot.data()) ? snapshot.data() : null
    if (!existing) return
    const compact = projectTaskReadModelTask(taskId, task)
    // A task mutation can carry FieldValue transforms. They cannot live inside
    // an array element, so make the projection's freshness concrete.
    delete compact.createdAt
    compact.updatedAt = new Date().toISOString()
    const tasks = [
      ...existing.tasks.filter((candidate: { id: string }) => candidate.id !== taskId),
      compact,
    ].sort((left, right) => taskOrderMillis(left.order) - taskOrderMillis(right.order))
    tx.set(ref, { ...existing, tasks, updatedAt: FieldValue.serverTimestamp() })
  })
}

export async function removeProjectTaskReadModelTask(projectId: string, taskId: string) {
  const ref = readModelRef(projectId)
  await adminDb.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref)
    const existing = snapshot.exists && isProjectTaskReadModel(snapshot.data()) ? snapshot.data() : null
    if (!existing) return
    tx.set(ref, {
      ...existing,
      tasks: existing.tasks.filter((task: { id: string }) => task.id !== taskId),
      updatedAt: FieldValue.serverTimestamp(),
    })
  })
}
