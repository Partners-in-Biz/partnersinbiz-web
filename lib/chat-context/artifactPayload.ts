export type StudioArtifactRichPart = {
  type: 'studio_artifact' | 'studio_artifact_bundle'
  artifactIds: string[]
}

const MAX_BUNDLE_ARTIFACTS = 20

function cleanId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const id = value.trim()
  return id && id.length <= 500 ? id : null
}

/**
 * Rich messages carry stable identities only. Titles, status and previews are
 * deliberately discarded so the renderer must rehydrate authoritative data.
 */
export function normalizeStudioArtifactPart(value: unknown): StudioArtifactRichPart | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.type !== 'studio_artifact' && record.type !== 'studio_artifact_bundle') return null
  const rawIds = Array.isArray(record.artifactIds)
    ? record.artifactIds
    : Array.isArray(record.artifact_ids)
      ? record.artifact_ids
      : [record.artifactId ?? record.artifact_id ?? record.id]
  const artifactIds = [...new Set(rawIds.map(cleanId).filter((id): id is string => Boolean(id)))].slice(0, MAX_BUNDLE_ARTIFACTS)
  if (artifactIds.length === 0) return null
  return { type: record.type, artifactIds }
}
