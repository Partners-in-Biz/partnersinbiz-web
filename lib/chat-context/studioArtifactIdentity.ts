import type { StudioKind } from './types'

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function decode(value: string): string | null {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return null
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8')
    return decoded && encode(decoded) === value ? decoded : null
  } catch {
    return null
  }
}

export type StudioArtifactIdentity = {
  studioKind: StudioKind
  orgId: string
  resourceType: string
  resourceId: string
}

const STUDIO_KINDS = new Set<StudioKind>([
  'marketing_studio', 'video_editor', 'book_studio', 'youtube_studio', 'mobile_apps',
])

export function studioArtifactContextId(identity: StudioArtifactIdentity): string {
  return `${identity.studioKind}:org:${encode(identity.orgId)}:${identity.resourceType}:${encode(identity.resourceId)}`
}

export function parseStudioArtifactContextId(id: string): StudioArtifactIdentity | null {
  const parts = id.split(':')
  if (parts.length !== 5 || parts[1] !== 'org' || !parts[0] || !parts[3]) return null
  const orgId = decode(parts[2])
  const resourceId = decode(parts[4])
  if (!orgId || !resourceId) return null
  if (!STUDIO_KINDS.has(parts[0] as StudioKind)) return null
  const identity = { studioKind: parts[0] as StudioKind, orgId, resourceType: parts[3], resourceId }
  return studioArtifactContextId(identity) === id ? identity : null
}
