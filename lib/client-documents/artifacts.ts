import * as crypto from 'node:crypto'

import { getStorage } from 'firebase-admin/storage'

import { getAdminApp } from '@/lib/firebase/admin'

const DURABLE_URL_KEYS = new Set([
  'pdfSnapshotUrl',
  'downloadUrl',
  'signedUrl',
  'artifactUrl',
])

type StorageFile = {
  getSignedUrl: (options: Record<string, unknown>) => Promise<[string] | string[]>
  setMetadata: (metadata: Record<string, unknown>) => Promise<unknown>
}

type StorageBucket = {
  file: (path: string) => StorageFile
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function defaultBucket(): StorageBucket {
  return getStorage(getAdminApp()).bucket() as unknown as StorageBucket
}

export function collectDocumentArtifactStoragePaths(input: {
  signatureRequests?: Array<Record<string, unknown> | null | undefined>
  signedByExternal?: Record<string, unknown> | null
}): string[] {
  const paths = new Set<string>()
  for (const row of input.signatureRequests ?? []) {
    const path = cleanString(row?.pdfSnapshotPath)
    if (path) paths.add(path)
  }
  const externalPath = cleanString(input.signedByExternal?.pdfSnapshotPath)
  if (externalPath) paths.add(externalPath)
  return Array.from(paths)
}

export function stripDurableArtifactUrls(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input
  if (Array.isArray(input)) return input.map(stripDurableArtifactUrls)

  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (DURABLE_URL_KEYS.has(key)) continue
    output[key] = stripDurableArtifactUrls(value)
  }
  return output
}

export async function issueDocumentArtifactReadUrl(
  storagePath: string,
  options: {
    bucket?: StorageBucket
    nowMs?: () => number
    ttlMs?: number
  } = {},
): Promise<{ url: string; expiresAt: string; storagePath: string }> {
  const path = cleanString(storagePath)
  if (!path) throw new Error('storagePath is required')

  const nowMs = options.nowMs ?? Date.now
  const ttlMs = Math.min(Math.max(options.ttlMs ?? 5 * 60_000, 30_000), 15 * 60_000)
  const expiresAtMs = nowMs() + ttlMs
  const bucket = options.bucket ?? defaultBucket()
  const [url] = await bucket.file(path).getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: new Date(expiresAtMs),
  })

  return {
    url,
    expiresAt: new Date(expiresAtMs).toISOString(),
    storagePath: path,
  }
}

export async function revokeDocumentArtifactTokens(
  storagePaths: string[],
  options: {
    bucket?: StorageBucket
    randomToken?: () => string
  } = {},
): Promise<number> {
  const unique = Array.from(new Set(storagePaths.map(cleanString).filter(Boolean)))
  if (unique.length === 0) return 0

  const bucket = options.bucket ?? defaultBucket()
  const randomToken = options.randomToken ?? (() => crypto.randomUUID())
  let revoked = 0

  for (const path of unique) {
    try {
      await bucket.file(path).setMetadata({
        metadata: {
          firebaseStorageDownloadTokens: randomToken(),
        },
        cacheControl: 'private, max-age=0, no-store',
      })
      revoked += 1
    } catch {
      // Best-effort: missing objects or emulator storage should not block revoke flows.
    }
  }

  return revoked
}
