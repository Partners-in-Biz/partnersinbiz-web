export type StudioArtifactRichPart = {
  type: 'studio_artifact' | 'studio_artifact_bundle'
  artifacts: StudioArtifactLocator[]
}

export type StudioArtifactLocator = { id: string; contextId: string }

const MAX_BUNDLE_ARTIFACTS = 20

function cleanId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const id = value.trim()
  return id && id.length <= 200 && /^[A-Za-z0-9._:-]+$/.test(id) ? id : null
}

/**
 * Rich messages carry stable identities only. Titles, status and previews are
 * deliberately discarded so the renderer must rehydrate authoritative data.
 */
export function normalizeStudioArtifactPart(value: unknown): StudioArtifactRichPart | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.type !== 'studio_artifact' && record.type !== 'studio_artifact_bundle') return null
  const rawLocators = Array.isArray(record.artifacts) ? record.artifacts : null
  if (rawLocators) {
    const artifacts: StudioArtifactLocator[] = []
    const seen = new Set<string>()
    for (const value of rawLocators) {
      if (!value || typeof value !== 'object') continue
      const item = value as Record<string, unknown>
      const id = cleanId(item.id ?? item.artifactId ?? item.artifact_id)
      const contextId = cleanId(item.contextId ?? item.context_id ?? item.parentContextId ?? item.parent_context_id)
      if (!id || !contextId || id.split(':', 1)[0] !== contextId.split(':', 1)[0]) continue
      const key = `${contextId}\u0000${id}`
      if (seen.has(key)) continue
      seen.add(key)
      artifacts.push({ id, contextId })
      if (artifacts.length === MAX_BUNDLE_ARTIFACTS) break
    }
    return artifacts.length ? { type: record.type, artifacts } : null
  }
  const rawIds = Array.isArray(record.artifactIds)
    ? record.artifactIds
    : Array.isArray(record.artifact_ids)
      ? record.artifact_ids
      : [record.artifactId ?? record.artifact_id ?? record.id]
  const contextId = cleanId(record.contextId ?? record.context_id ?? record.parentContextId ?? record.parent_context_id)
  const artifactIds = [...new Set(rawIds.map(cleanId).filter((id): id is string => Boolean(id)))].slice(0, MAX_BUNDLE_ARTIFACTS)
  const artifacts = artifactIds.map((id) => ({ id, contextId: contextId ?? id }))
    .filter((item) => item.id.split(':', 1)[0] === item.contextId.split(':', 1)[0])
  if (artifacts.length === 0) return null
  return { type: record.type, artifacts }
}
