import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { apiError } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import type { ApiUser } from '@/lib/api/types'

type PlainRecord = Record<string, unknown>

export const YOUTUBE_COLLECTIONS = {
  channels: 'youtube_channel_workspaces',
  series: 'youtube_series',
  videos: 'youtube_video_projects',
  packets: 'youtube_publishing_packets',
  releasePlans: 'youtube_release_plans',
  sourceAssets: 'youtube_source_assets',
  clipCandidates: 'youtube_clip_candidates',
  productionDrafts: 'youtube_production_drafts',
  renderJobs: 'youtube_render_jobs',
  agentJobs: 'youtube_agent_jobs',
  agentArtifacts: 'youtube_agent_job_artifacts',
  analytics: 'youtube_analytics_snapshots',
} as const

export function actorFields(user: ApiUser) {
  const actorType = user.role === 'ai' ? 'agent' : 'user'

  return {
    createdBy: user.uid,
    createdByType: actorType,
    updatedBy: user.uid,
    updatedByType: actorType,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }
}

export function updateActorFields(user: ApiUser) {
  return {
    updatedBy: user.uid,
    updatedByType: user.role === 'ai' ? 'agent' : 'user',
    updatedAt: FieldValue.serverTimestamp(),
  }
}

export async function ensureOrgAccess(user: ApiUser, orgId: string) {
  if (!orgId) return apiError('orgId is required', 400)
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)

  const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgDoc.exists) return apiError('Organisation not found', 404)

  return null
}

export async function listByOrg(collectionName: string, orgId: string) {
  const snap = await adminDb.collection(collectionName).where('orgId', '==', orgId).get()
  return snap.docs.filter((doc) => doc.data()?.deleted !== true)
}

export async function loadScopedRecord(collectionName: string, id: string) {
  if (!id) return null

  const doc = await adminDb.collection(collectionName).doc(id).get()
  if (!doc.exists) return null

  return {
    id: doc.id,
    ref: doc.ref,
    data: doc.data() as PlainRecord,
  }
}

function isPlainRecord(value: unknown): value is PlainRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function deepMerge(existing: PlainRecord, patch: PlainRecord): PlainRecord {
  const merged: PlainRecord = { ...existing }

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue

    const current = merged[key]
    if (isPlainRecord(current) && isPlainRecord(value)) {
      merged[key] = deepMerge(current, value)
      continue
    }

    merged[key] = value
  }

  return merged
}

export function mergePatchForSanitizer(
  existing: PlainRecord,
  patch: PlainRecord,
  lockedFields: PlainRecord = {},
): PlainRecord {
  return {
    ...deepMerge(existing, patch),
    ...lockedFields,
  }
}

export function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefinedDeep(item))
      .filter((item) => item !== undefined) as T
  }

  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, entry]) => {
        if (entry === undefined) return []
        const cleanEntry = stripUndefinedDeep(entry)
        return cleanEntry === undefined ? [] : [[key, cleanEntry]]
      })
    ) as T
  }

  return value
}
