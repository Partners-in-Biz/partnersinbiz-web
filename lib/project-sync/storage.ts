import { createHash } from 'node:crypto'
import { getStorage } from 'firebase-admin/storage'
import { getAdminApp } from '@/lib/firebase/admin'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SHA256 = /^[a-f0-9]{64}$/
const MAX_OBJECT_BYTES = 100 * 1024 * 1024

interface ProjectSyncStorageFile {
  getSignedUrl(options: Record<string, unknown>): Promise<[string] | string[]>
  createReadStream?(): NodeJS.ReadableStream & AsyncIterable<Buffer | string>
  setMetadata?(metadata: Record<string, unknown>): Promise<unknown>
  getMetadata?(): Promise<[Record<string, unknown>] | Record<string, unknown>[]>
  delete?(options?: Record<string, unknown>): Promise<unknown>
}

export interface ProjectSyncStorageBucket {
  file(objectPath: string): ProjectSyncStorageFile
}

export interface ProjectSyncObjectIdentity {
  orgId: string
  projectId: string
  sha256: string
  size: number
}

export interface ProjectSyncSignedObject extends ProjectSyncObjectIdentity {
  objectPath: string
  url: string
  expiresAt: string
  headers?: Record<string, string>
}

function identifier(value: string, field: string): string {
  const clean = value.trim()
  if (!SAFE_ID.test(clean)) throw new Error(`project sync storage ${field} is invalid`)
  return clean
}

function identity(input: ProjectSyncObjectIdentity): ProjectSyncObjectIdentity {
  const sha256 = input.sha256.trim().toLowerCase()
  if (!SHA256.test(sha256)) throw new Error('project sync storage sha256 is invalid')
  if (!Number.isSafeInteger(input.size) || input.size < 0 || input.size > MAX_OBJECT_BYTES) {
    throw new Error('project sync storage size is invalid')
  }
  return {
    orgId: identifier(input.orgId, 'orgId'),
    projectId: identifier(input.projectId, 'projectId'),
    sha256,
    size: input.size,
  }
}

export function projectSyncObjectPath(input: Pick<ProjectSyncObjectIdentity, 'orgId' | 'projectId' | 'sha256'>): string {
  const checked = identity({ ...input, size: 0 })
  return `project-sync/${checked.orgId}/${checked.projectId}/objects/${checked.sha256}`
}

function trustedMetadata(metadata: Record<string, unknown>, checked: ProjectSyncObjectIdentity): boolean {
  const custom = metadata.metadata && typeof metadata.metadata === 'object'
    ? metadata.metadata as Record<string, unknown>
    : {}
  return custom.projectSyncVerified === 'true'
    && custom.projectSyncSha256 === checked.sha256
    && custom.projectSyncSize === String(checked.size)
    && String(metadata.size ?? checked.size) === String(checked.size)
}

export function createProjectSyncStorageBroker(options: {
  bucket?: ProjectSyncStorageBucket
  nowMs?: () => number
  ttlMs?: number
} = {}) {
  const bucket = options.bucket ?? getStorage(getAdminApp()).bucket() as unknown as ProjectSyncStorageBucket
  const nowMs = options.nowMs ?? Date.now
  const ttlMs = Math.min(Math.max(options.ttlMs ?? 15 * 60_000, 30_000), 15 * 60_000)

  return {
    async signUpload(input: ProjectSyncObjectIdentity): Promise<ProjectSyncSignedObject> {
      const checked = identity(input)
      const objectPath = projectSyncObjectPath(checked)
      const expiresAtMs = nowMs() + ttlMs
      const [url] = await bucket.file(objectPath).getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: new Date(expiresAtMs),
        contentType: 'application/octet-stream',
        extensionHeaders: {
          'content-length': String(checked.size),
          'x-goog-if-generation-match': '0',
        },
      })
      return {
        ...checked,
        objectPath,
        url,
        expiresAt: new Date(expiresAtMs).toISOString(),
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': String(checked.size),
          'x-goog-if-generation-match': '0',
        },
      }
    },

    async verifyUpload(input: ProjectSyncObjectIdentity): Promise<ProjectSyncObjectIdentity & { objectPath: string; verified: true }> {
      const checked = identity(input)
      const objectPath = projectSyncObjectPath(checked)
      const file = bucket.file(objectPath)
      if (!file.createReadStream || !file.setMetadata || !file.getMetadata) {
        throw new Error('project sync storage verification is unavailable')
      }
      const [metadata] = await file.getMetadata()
      const generation = Number(metadata.generation)
      try {
        const hash = createHash('sha256')
        let size = 0
        for await (const chunk of file.createReadStream()) {
          const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk)
          size += bytes.byteLength
          if (size > checked.size) throw new Error('project sync object size verification failed')
          hash.update(bytes)
        }
        if (size !== checked.size) throw new Error('project sync object size verification failed')
        if (hash.digest('hex') !== checked.sha256) throw new Error('project sync object hash verification failed')
        await file.setMetadata({
          cacheControl: 'private, max-age=0, no-store',
          customTime: new Date(nowMs()).toISOString(),
          metadata: {
            projectSyncVerified: 'true',
            projectSyncSha256: checked.sha256,
            projectSyncSize: String(checked.size),
            projectSyncVerifiedAt: new Date(nowMs()).toISOString(),
          },
        })
      } catch (error) {
        if (file.delete && Number.isSafeInteger(generation) && generation >= 0) {
          await file.delete({ preconditionOpts: { ifGenerationMatch: generation } }).catch(() => undefined)
        }
        throw error
      }
      return { ...checked, objectPath, verified: true }
    },

    async signDownload(input: ProjectSyncObjectIdentity): Promise<ProjectSyncSignedObject> {
      const checked = identity(input)
      const objectPath = projectSyncObjectPath(checked)
      const file = bucket.file(objectPath)
      if (!file.getMetadata || !file.setMetadata) {
        throw new Error('project sync object verification metadata is unavailable')
      }
      const [metadata] = await file.getMetadata()
      if (!trustedMetadata(metadata, checked)) throw new Error('project sync object is not verified')
      const refreshedAtMs = nowMs()
      // Cloud Storage setMetadata is a partial patch. Updating only customTime
      // refreshes the lifecycle clock without replacing the verified custom
      // metadata that binds this immutable CAS object to its hash and size.
      await file.setMetadata({ customTime: new Date(refreshedAtMs).toISOString() })
      const expiresAtMs = refreshedAtMs + ttlMs
      const [url] = await file.getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: new Date(expiresAtMs),
      })
      return { ...checked, objectPath, url, expiresAt: new Date(expiresAtMs).toISOString() }
    },
  }
}

export type ProjectSyncStorageBroker = ReturnType<typeof createProjectSyncStorageBroker>
