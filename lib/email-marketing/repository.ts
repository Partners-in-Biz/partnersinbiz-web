import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import {
  adaptLegacyRecord,
  type EmailProgramAdapterResult,
  type LegacyRecord,
} from './adapters'
import {
  EMAIL_PROGRAM_RECORD_TYPE,
  EMAIL_PROGRAM_SCHEMA_VERSION,
  type EmailProgram,
  type EmailProgramSourceCollection,
  type EmailProgramStatus,
  type NewEmailProgram,
} from './types'

const PROGRAM_COLLECTIONS: EmailProgramSourceCollection[] = [
  'campaigns',
  'broadcasts',
  'sequences',
  'communication_campaigns',
]

export interface ListEmailProgramsOptions {
  status?: EmailProgramStatus
  limit?: number
}

export interface ListEmailProgramsResult {
  programs: EmailProgram[]
  issues: Array<Extract<EmailProgramAdapterResult, { ok: false }>>
}

export type CreateEmailProgramInput = Omit<NewEmailProgram, 'orgId'>

/**
 * Migration-safe facade over existing collections. Reads are unified through
 * adapters; records stay in their original collection and are never rewritten
 * or deleted as a side effect of a read.
 */
export class EmailProgramRepository {
  constructor(private readonly db: Firestore = adminDb) {}

  async list(orgId: string, options: ListEmailProgramsOptions = {}): Promise<ListEmailProgramsResult> {
    assertOrgId(orgId)
    const perCollectionLimit = clampLimit(options.limit ?? 500)
    const snapshots = await Promise.all(
      PROGRAM_COLLECTIONS.map((collection) =>
        this.db.collection(collection).where('orgId', '==', orgId).limit(perCollectionLimit).get(),
      ),
    )

    const programs: EmailProgram[] = []
    const issues: ListEmailProgramsResult['issues'] = []
    snapshots.forEach((snapshot, index) => {
      const collection = PROGRAM_COLLECTIONS[index]
      for (const document of snapshot.docs) {
        const raw = { id: document.id, ...document.data() } as LegacyRecord
        if (raw.deleted === true) continue
        const result = adaptLegacyRecord(collection, raw)
        if (!result.ok) {
          issues.push(result)
          continue
        }
        // Defence in depth: never return a record whose adapter changed or
        // omitted the tenant carried by the scoped Firestore query.
        if (result.program.orgId !== orgId) {
          issues.push({
            ok: false,
            code: 'invalid_record',
            source: { collection, id: document.id, orgId: result.program.orgId },
            message: 'Adapter returned a program outside the requested organisation',
          })
          continue
        }
        if (!options.status || result.program.status === options.status) programs.push(result.program)
      }
    })

    programs.sort((a, b) => timestampMillis(b.updatedAt ?? b.createdAt) - timestampMillis(a.updatedAt ?? a.createdAt))
    return { programs: programs.slice(0, perCollectionLimit), issues }
  }

  async get(
    orgId: string,
    source: Pick<EmailProgram['source'], 'collection' | 'id'>,
  ): Promise<EmailProgram | null> {
    assertOrgId(orgId)
    if (!PROGRAM_COLLECTIONS.includes(source.collection)) return null
    if (!source.id.trim()) return null
    const snapshot = await this.db.collection(source.collection).doc(source.id).get()
    if (!snapshot.exists) return null
    const raw = { id: snapshot.id, ...snapshot.data() } as LegacyRecord
    if (raw.orgId !== orgId || raw.deleted === true) return null
    const result = adaptLegacyRecord(source.collection, raw)
    return result.ok && result.program.orgId === orgId ? result.program : null
  }

  /**
   * Creates only canonical v2 records. Existing legacy documents are not
   * updated, dual-written, or deleted. Future executors can opt into these
   * records after their own compatibility gates pass.
   */
  async create(orgId: string, input: CreateEmailProgramInput): Promise<EmailProgram> {
    assertOrgId(orgId)
    const ref = this.db.collection('campaigns').doc()
    const source = { collection: 'campaigns' as const, id: ref.id, legacy: false }
    const timestamps = FieldValue.serverTimestamp()
    const write = {
      ...input,
      id: ref.id,
      orgId,
      recordType: EMAIL_PROGRAM_RECORD_TYPE,
      schemaVersion: EMAIL_PROGRAM_SCHEMA_VERSION,
      source,
      createdAt: timestamps,
      updatedAt: timestamps,
      deleted: false,
    }
    await ref.set(write)
    return {
      ...input,
      id: ref.id,
      orgId,
      recordType: EMAIL_PROGRAM_RECORD_TYPE,
      schemaVersion: EMAIL_PROGRAM_SCHEMA_VERSION,
      source,
      createdAt: null,
      updatedAt: null,
    } as EmailProgram
  }
}

export const emailProgramRepository = new EmailProgramRepository()

function assertOrgId(orgId: string): void {
  if (!orgId.trim()) throw new Error('orgId is required')
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 500
  return Math.max(1, Math.min(500, Math.floor(limit)))
}

function timestampMillis(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (typeof value === 'object') {
    const candidate = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof candidate.toMillis === 'function') return candidate.toMillis()
    if (typeof candidate.toDate === 'function') return candidate.toDate().getTime()
    const seconds = candidate.seconds ?? candidate._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return 0
}
